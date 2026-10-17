/**
 * Data Sync Service
 *
 * Syncs encrypted domain records between the local plaintext DB and PocketBase.
 * The sync boundary is scope-based:
 * - user scope uses the user master key and the `records` collection
 * - room scope uses the active room key and the `multi_room_records` collection
 *
 * Server records carry `kind` to route one remote collection back into local tables.
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '../session';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { decryptBytes, encryptBytes, fromBase64, toBase64, type EncryptedData } from '$lib/crypto';
import {
    localDB,
    type TableName,
    SYNC_TABLES,
    type DataRecord,
    type DataScope,
    type DatabaseWriteEvent,
    type SyncScopeAdoption
} from '$lib/adapters/db';
import { syncCursorDB, type SyncCursorState } from '$lib/adapters/sync';
import { BaseRecordSyncEngine, type BufferedRecordWrite } from './base';
import { createLogger } from '$lib/adapters/logger';
import { clock } from '$lib/utils/clock';
import { AssetService } from '$lib/services/asset';
import { normalizeUrl } from '$lib/utils/url';
import {
    normalizeTimestamp,
    PAGE_SIZE,
    CHUNK_SIZE,
    belongsToScope,
    getServerNow,
    assertSyncServer,
    getSyncCursorIdentity,
    getActiveSyncScopes,
    getRealtimeScope,
    type SyncScope,
    type RealtimeEvent,
    isReadyToSync,
    toErrorState
} from './utils';
import type { AssetEntries } from '$lib/types/asset';
import { AppError, isErrorCode } from '$lib/types/errors';
import {
    cascadeDeleteChildren,
    cleanupCascadeAssets,
    type CascadeResult
} from '$lib/services/content/cascade';
import {
    assertIngestCovered,
    collectGarbage,
    commitSyncSession,
    adoptServerScope,
    beginBootstrap,
    isSafetyError,
    openSyncSession,
    SYNC_BOOTSTRAP_HEADER,
    SYNC_COVERAGE_HEADER,
    SYNC_LINEAGE_HEADER,
    type SessionContext,
    toSyncSafetyError,
    type SyncSession
} from './safety';

type RemoteCollection = 'records' | 'multi_room_records';

interface LocalChange {
    table: TableName;
    record: DataRecord;
}

interface ChangeRef {
    table: TableName;
    id: string;
}

type SessionCoverage = Pick<SyncSession, 'localCoverage' | 'serverCoverage' | 'lineage'> & {
    /** The local replica the coverage was proven for; see replaceReplica. */
    epoch: number;
};

/** What a Push proves to the server: coverage of its forgotten deletions, and its lineage. */
interface PushProof {
    coverage: number;
    lineage: string;
    bootstrapToken?: string;
    /** Server responses merge only into this local replica. */
    epoch: number;
}

/**
 * A scope on a server whose state cannot be merged with this device's: `unsafe` when both
 * hold data that cannot be proven safe to merge, `init` when this device's data was never
 * synced and the server holds another replica. Resolved only by the user's choice.
 */
export interface SyncConflict {
    serverUrl: string;
    scope: DataScope;
    kind: 'unsafe' | 'init';
    /** The server's lineage the user resolves against; an overwrite requires it unchanged. */
    serverLineage: string | null;
    /** Another device's unfinished initialization holds the server: it cannot be adopted. */
    serverInitializing: boolean;
    /** This user may overwrite the server's copy (a room's owner, or the user's own scope). */
    canOverwrite: boolean;
}

export type SyncConflictChoice = 'local' | 'server';

interface DecodedRemoteRecord {
    table: TableName;
    record: DataRecord;
}

interface AssetReconciliation {
    table: TableName;
    before: DataRecord | undefined;
    after: DataRecord;
}

interface RealtimeMergeResult {
    assetReconciliation: AssetReconciliation | null;
    cascadeTarget: { table: TableName; id: string } | null;
}

const logger = createLogger('sync:data');
/** Clean checkpoints handed to a bootstrapped server, newest first. */
const MAX_BOOTSTRAP_CLEAN = 100;
const USER_RECORDS_COLLECTION: RemoteCollection = 'records';
const ROOM_RECORDS_COLLECTION: RemoteCollection = 'multi_room_records';

export class DataRecordSyncEngineImpl extends BaseRecordSyncEngine<DatabaseWriteEvent, TableName> {
    private subscribed = false;
    /** Verified H–C sessions per server and scope; their coverage facts never expire. */
    private readonly sessions = new Map<string, SyncSession>();
    /** Last session failure of an unverified server scope; regular sync triggers retry it. */
    private readonly blocked = new Map<string, unknown>();
    private readonly conflicts = new Map<string, SyncConflict>();
    private readonly conflictListeners = new Set<(conflicts: SyncConflict[]) => void>();
    /** Overwrites of a server's scope the user chose, applied by the next full sync. */
    private readonly overwrites = new Map<string, SyncConflict>();
    private readonly resolving = new Set<string>();
    /** Bumped whenever a scope's local replica is replaced (adoption) or re-lineaged. */
    private readonly epochs = new Map<string, number>();
    /** Merges into the current replica of a scope, awaited before it is replaced. */
    private readonly merges = new Map<string, Set<Promise<unknown>>>();

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    /** A stopped engine re-verifies every scope through its next full session. */
    override stop(): void {
        super.stop();
        this.sessions.clear();
        this.blocked.clear();
        this.overwrites.clear();
        this.conflicts.clear();
        this.emitConflicts();
    }

    subscribeConflicts(listener: (conflicts: SyncConflict[]) => void): () => void {
        this.conflictListeners.add(listener);
        listener([...this.conflicts.values()]);
        return () => {
            this.conflictListeners.delete(listener);
        };
    }

    /**
     * Resolve a conflict by replacing one replica with the other.
     *
     * `server` replaces this device's scope with the server's: the choice is recorded durably
     * first, so an interrupted adoption restarts instead of leaving a partial replica.
     * `local` replaces the server's scope with this device's under a new lineage, provided the
     * server still holds the lineage the user saw. Either runs inside the next full sync.
     */
    async resolveConflict(conflict: SyncConflict, choice: SyncConflictChoice): Promise<void> {
        const key = this.scopeKey(conflict.scope, conflict.serverUrl);
        if (normalizeUrl(pb.baseUrl) !== conflict.serverUrl) {
            throw new AppError('INVALID_INPUT', 'The sync server changed; sync again first');
        }
        if (this.resolving.has(key)) {
            throw new AppError('INVALID_INPUT', 'This conflict is already being resolved');
        }
        // A resolution answers the conflict still reported for that server state; a repeated
        // or stale one must not replace a replica again after it changed.
        const current = this.conflicts.get(key);
        if (current?.kind !== conflict.kind || current.serverLineage !== conflict.serverLineage) {
            throw new AppError('INVALID_INPUT', 'This conflict is no longer current');
        }
        this.resolving.add(key);
        try {
            if (choice === 'server') {
                const state = await localDB.getSyncScopeState(conflict.scope);
                await localDB.setSyncScopeState(conflict.scope, {
                    ...state,
                    adopting: { discard: true, adopted: null },
                    bootstrapping: null
                });
            } else {
                this.overwrites.set(key, conflict);
            }
            this.blocked.delete(key);
            await this.trigger();
            const failure = this.blocked.get(key);
            if (failure !== undefined || this.conflicts.has(key)) {
                throw failure ?? new AppError('SYNC_UNSAFE', 'The conflict was not resolved');
            }
        } finally {
            this.overwrites.delete(key);
            this.resolving.delete(key);
        }
    }

    async subscribeRealtime(): Promise<void> {
        if (!isReadyToSync()) return;

        await this.unsubscribeRealtime();
        const serverUrl = normalizeUrl(pb.baseUrl);

        try {
            await pb.collection(USER_RECORDS_COLLECTION).subscribe('*', (e) => {
                void this.handleRealtimeEvent(
                    USER_RECORDS_COLLECTION,
                    serverUrl,
                    e as unknown as RealtimeEvent
                );
            });

            const { roomId, roomKey } = getActiveSession();
            if (roomId && roomKey) {
                await pb.collection(ROOM_RECORDS_COLLECTION).subscribe('*', (e) => {
                    void this.handleRealtimeEvent(
                        ROOM_RECORDS_COLLECTION,
                        serverUrl,
                        e as unknown as RealtimeEvent
                    );
                });
            }
        } catch (err) {
            await this.unsubscribeRealtime();
            this.updateStatus({ state: toErrorState(err) });
            return;
        }
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
        for (const collection of [USER_RECORDS_COLLECTION, ROOM_RECORDS_COLLECTION]) {
            try {
                await pb.collection(collection).unsubscribe('*');
            } catch {
                /* ignore */
            }
        }
        this.subscribed = false;
    }

    /** Wipe the user's record cursors for the active server. */
    async resetCursor(userId: string): Promise<void> {
        await syncCursorDB.deleteByStream({
            serverUrl: normalizeUrl(pb.baseUrl),
            userId,
            stream: 'records'
        });
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;

        let firstError: unknown = null;
        let completed = 0;
        // Every remote call of this run must reach the server its proofs belong to.
        const serverUrl = normalizeUrl(pb.baseUrl);
        // Read the committed storage revision; later commits remain pending for the next pass.
        const localUpper = await localDB.getLocalUpdatedAt();
        const serverUpper = await getServerNow();
        assertSyncServer(serverUrl);
        const scopes = getActiveSyncScopes(USER_RECORDS_COLLECTION, ROOM_RECORDS_COLLECTION);

        const results = await Promise.allSettled(
            scopes.map(async (scope) => {
                await this.syncScope(scope, serverUrl, localUpper, serverUpper);
                completed++;
                this.updateStatus({
                    progress: {
                        completed,
                        total: scopes.length,
                        currentItemId: scope.scope.scopeId
                    }
                });
            })
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                firstError ??= result.reason;
            }
        }

        if (firstError) {
            throw firstError;
        }
    }

    /**
     * Decide how the scope proceeds with this server, then run it: a verified session, an
     * adoption of the server's replica, a bootstrap of the server, or a refusal.
     */
    private async syncScope(
        syncScope: SyncScope,
        serverUrl: string,
        localUpper: number,
        serverUpper: number
    ): Promise<void> {
        const { scope } = syncScope;
        const key = this.sessionKey(syncScope, serverUrl);
        try {
            const state = await localDB.getSyncScopeState(scope);
            if (state.adopting?.adopted) {
                await this.resumeAdoption(syncScope, serverUrl, state.adopting.adopted);
                return;
            }
            if (state.adopting) {
                // Nothing was pulled yet: start over with the same intent.
                await this.adoptScope(syncScope, serverUrl, state.adopting.discard);
                return;
            }
            const { userId } = getActiveSession();
            const cursors = await syncCursorDB.get(getSyncCursorIdentity('records', userId, scope));
            const pending =
                state.bootstrapping?.serverUrl === serverUrl ? state.bootstrapping : null;
            // Refuse before any data moves when GC may have forgotten a deletion the peer lacks.
            const opened = await openSyncSession(syncScope, serverUrl, cursors, {
                lineage: state.lineage,
                hasRecords: await localDB.hasScopeRecords(scope),
                bootstrapToken: pending?.token
            });
            if (pending && opened.plan !== 'bootstrap') {
                // The server no longer holds this client's lease: the bootstrap committed (its
                // response may have been lost), or it was refused or superseded.
                await localDB.setSyncScopeState(scope, { ...state, bootstrapping: null });
            }
            const overwrite = this.overwrites.get(key);
            if (overwrite && (opened.plan === 'conflict' || opened.plan === 'init')) {
                await this.bootstrapServer(
                    syncScope,
                    serverUrl,
                    'overwrite',
                    overwrite.serverLineage,
                    crypto.randomUUID()
                );
                return;
            }

            switch (opened.plan) {
                case 'sync':
                    this.sessions.set(key, opened.session);
                    this.blocked.delete(key);
                    await this.runSession(
                        syncScope,
                        serverUrl,
                        localUpper,
                        serverUpper,
                        cursors,
                        opened.session
                    );
                    this.setConflict(key, null);
                    return;
                case 'adopt':
                    // Planned because the scope held nothing: whatever was written since is new.
                    await this.adoptScope(syncScope, serverUrl, false);
                    return;
                case 'bootstrap':
                    if (opened.remoteLineage === null) {
                        await this.bootstrapServer(
                            syncScope,
                            serverUrl,
                            'init',
                            null,
                            state.lineage ?? crypto.randomUUID()
                        );
                    } else {
                        // This client holds the lease: redo its own interrupted bootstrap,
                        // presenting the lease so a room member may redo it too.
                        await this.bootstrapServer(
                            syncScope,
                            serverUrl,
                            'overwrite',
                            opened.remoteLineage,
                            opened.remoteLineage,
                            pending?.token
                        );
                    }
                    return;
                case 'wait':
                    throw new AppError('SYNC_INITIALIZING', 'Another device is initializing');
                case 'conflict':
                case 'init':
                    this.setConflict(key, {
                        serverUrl,
                        scope,
                        kind: opened.plan === 'init' ? 'init' : 'unsafe',
                        serverLineage: opened.remoteLineage,
                        serverInitializing: opened.remoteInitializing,
                        canOverwrite: opened.canOverwrite
                    });
                    throw new AppError(
                        opened.plan === 'init' ? 'SYNC_NEEDS_INIT' : 'SYNC_UNSAFE',
                        `Merge of ${scope.scopeType} scope cannot be proven safe`
                    );
            }
        } catch (err) {
            if (!this.sessions.has(key)) this.blocked.set(key, err);
            else this.recordRefusal(key, err);
            throw err;
        }
    }

    /**
     * Replace this device's replica of the scope with the server's.
     *
     * The `adopting` mark is written first and cleared last, so a partial adoption is never
     * used as a replica. The scope's watermark, checkpoints and every server's cursors go,
     * and its records only if the user chose the server (`discard`): an automatic adoption was
     * planned because the scope held nothing, so whatever was written since is new local data
     * of the adopted replica. The server's forgotten deletions are taken over at one fresh
     * local revision, with checkpoints the server is clean on anchored there, and recorded in
     * the mark; from then on an interruption continues the adoption (resumeAdoption) instead of
     * restarting it, so no record kept so far is dropped. A verified session then pulls the
     * server's state and commits only if no GC outran the adoption; it serves other paths
     * only once the replica is durably marked as adopted.
     */
    private async adoptScope(
        syncScope: SyncScope,
        serverUrl: string,
        discard: boolean
    ): Promise<void> {
        const { scope } = syncScope;
        const { userId } = getActiveSession();
        this.sessions.delete(this.sessionKey(syncScope, serverUrl));
        await this.replaceReplica(scope);
        await localDB.setSyncScopeState(scope, {
            lineage: null,
            adopting: { discard, adopted: null },
            bootstrapping: null
        });
        await syncCursorDB.deleteByScope(userId, 'records', scope);
        if (discard) await AssetService.deleteScopeAssets(scope);
        await localDB.resetSyncScope(scope, { keepRecords: !discard });
        const response = await adoptServerScope(syncScope, serverUrl);
        await localDB.adoptSyncState(scope, {
            forgotten: response.gcHigh > 0,
            checkpoints: response.checkpoints
        });
        const adopted = { serverUrl, lineage: response.lineage, gcHigh: response.gcHigh };
        await localDB.setSyncScopeState(scope, {
            lineage: null,
            adopting: { discard, adopted },
            bootstrapping: null
        });
        await this.finishAdoption(syncScope, adopted);
    }

    /**
     * Continue an interrupted adoption on the server whose knowledge was taken over. Its
     * session proves itself like any other, so records pulled before the interruption are
     * only kept while the server can still vouch for them. If it cannot (another server, a
     * replaced lineage, or a GC past the adopted watermark), the mark is dropped and the scope
     * is planned again: holding records, it is a conflict for the user, never discarded.
     */
    private async resumeAdoption(
        syncScope: SyncScope,
        serverUrl: string,
        adopted: NonNullable<SyncScopeAdoption['adopted']>
    ): Promise<void> {
        const { scope } = syncScope;
        this.sessions.delete(this.sessionKey(syncScope, serverUrl));
        await this.replaceReplica(scope);
        try {
            if (adopted.serverUrl !== serverUrl) {
                throw new AppError('SYNC_UNSAFE', 'The adoption began on another server');
            }
            await this.finishAdoption(syncScope, adopted);
        } catch (err) {
            if (isSafetyError(err)) {
                await localDB.setSyncScopeState(scope, {
                    lineage: null,
                    adopting: null,
                    bootstrapping: null
                });
            }
            throw err;
        }
    }

    private async finishAdoption(
        syncScope: SyncScope,
        adopted: NonNullable<SyncScopeAdoption['adopted']>
    ): Promise<void> {
        const session = await this.runPrepared(syncScope, adopted.serverUrl, {
            lineage: adopted.lineage,
            adoptedGcHigh: adopted.gcHigh
        });
        await localDB.setSyncScopeState(syncScope.scope, {
            lineage: adopted.lineage,
            adopting: null,
            bootstrapping: null
        });
        this.verified(this.sessionKey(syncScope, adopted.serverUrl), session);
    }

    /**
     * Replace the server's replica of the scope with this device's.
     *
     * This replica takes `lineage` before anything is sent: an overwrite is the user's choice,
     * and nothing this replica receives from other servers afterwards may enter the new
     * lineage as the old one. The bootstrap's token is recorded with it, so only the lease it
     * identifies is ever resumed. The server replaces its scope state in one transaction and
     * stays initializing until a commit after the complete Push. A bootstrap checkpoint covers
     * this replica's whole prefix: both sides are clean on it, which proves this replica's
     * forgotten deletions.
     */
    private async bootstrapServer(
        syncScope: SyncScope,
        serverUrl: string,
        mode: 'init' | 'overwrite',
        expectedLineage: string | null,
        lineage: string,
        resumeToken?: string
    ): Promise<void> {
        const { scope } = syncScope;
        const key = this.sessionKey(syncScope, serverUrl);
        const { userId } = getActiveSession();
        // The server drops its references when it is replaced, and its GC may then drop the
        // bytes: every asset this replica keeps must be uploadable from here first.
        await AssetService.localizeScope(scope);
        this.sessions.delete(key);
        await this.replaceReplica(scope);
        const token =
            crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        await localDB.setSyncScopeState(scope, {
            lineage,
            adopting: null,
            bootstrapping: { serverUrl, lineage, token }
        });
        assertSyncServer(serverUrl);
        await syncCursorDB.delete(getSyncCursorIdentity('records', userId, scope));
        const gcHigh = await localDB.getSyncGcHigh(scope);
        const prefix = await localDB.getLocalUpdatedAt();
        const checkpoint = crypto.randomUUID();
        const clean = (await localDB.getSyncCheckpoints(scope))
            .filter(({ anchor }) => anchor > 0 && anchor >= gcHigh)
            .sort((a, b) => b.heldAt - a.heldAt)
            .slice(0, MAX_BOOTSTRAP_CLEAN)
            .map(({ id }) => id);
        await beginBootstrap(syncScope, serverUrl, {
            mode,
            expectedLineage,
            lineage,
            token,
            resumeToken,
            checkpoint,
            forgotten: gcHigh > 0,
            clean
        });
        await localDB.addSyncCheckpoints(scope, [{ id: checkpoint, anchor: prefix }]);
        const session = await this.runPrepared(syncScope, serverUrl, {
            lineage,
            bootstrapToken: token
        });
        await localDB.setSyncScopeState(scope, { lineage, adopting: null, bootstrapping: null });
        // Once committed, the token is spent; the session continues as a normal one.
        this.verified(key, { ...session, bootstrapToken: undefined });
    }

    /**
     * A session for a prepared scope; it must verify like any other before data moves. The
     * caller publishes it to the gate only after recording the scope's final state.
     */
    private async runPrepared(
        syncScope: SyncScope,
        serverUrl: string,
        context: SessionContext
    ): Promise<SyncSession> {
        const { userId } = getActiveSession();
        const cursors = await syncCursorDB.get(
            getSyncCursorIdentity('records', userId, syncScope.scope)
        );
        const localUpper = await localDB.getLocalUpdatedAt();
        const serverUpper = await getServerNow();
        assertSyncServer(serverUrl);
        const { session } = await openSyncSession(
            syncScope,
            serverUrl,
            cursors,
            { lineage: context.lineage, hasRecords: true },
            context
        );
        await this.runSession(syncScope, serverUrl, localUpper, serverUpper, cursors, session);
        return session;
    }

    /** Admit a scope to the gate after a replacement completed. */
    private verified(key: string, session: SyncSession): void {
        this.sessions.set(key, session);
        this.blocked.delete(key);
        this.setConflict(key, null);
    }

    private async runSession(
        syncScope: SyncScope,
        serverUrl: string,
        localUpper: number,
        serverUpper: number,
        cursors: SyncCursorState,
        session: SyncSession
    ): Promise<void> {
        const { userId } = getActiveSession();
        const cursorIdentity = getSyncCursorIdentity('records', userId, syncScope.scope);
        const pullCursor = cursors.serverPullCursor;
        const pushCursor = cursors.localPushCursor;
        const key = this.sessionKey(syncScope, serverUrl);
        let syncError: unknown = null;
        let pushError: unknown = null;
        const offlineWrites = new Map<string, LocalChange>();

        try {
            await this.pullRange(
                syncScope,
                serverUrl,
                session,
                pullCursor,
                serverUpper,
                offlineWrites
            );
        } catch (err) {
            syncError = err;
            logger.error(`Failed to pull ${syncScope.collection}`, err);
        }
        // A failed safety proof stops the whole scope: nothing is pushed or committed.
        if (isSafetyError(syncError)) {
            this.recordRefusal(key, syncError);
            throw syncError;
        }

        const hasPullCorrections = offlineWrites.size > 0;
        let pushedCount = 0;
        try {
            const scannedUnsynced = await this.collectUnsyncedChanges(
                syncScope.scope,
                pushCursor,
                localUpper
            );
            for (const change of scannedUnsynced) {
                offlineWrites.set(this.changeKey(change.table, change.record.id), change);
            }

            const unsynced = [...offlineWrites.values()];
            pushedCount = unsynced.length;
            if (unsynced.length > 0) {
                await this.pushChanges(
                    syncScope,
                    serverUrl,
                    unsynced,
                    {
                        coverage: session.serverCoverage,
                        lineage: session.lineage,
                        bootstrapToken: session.bootstrapToken,
                        epoch: this.epoch(syncScope.scope)
                    },
                    false
                );
            }
        } catch (err) {
            pushError = err;
        }

        const pushed = !pushError;
        // A bootstrap commit publishes the replica, so it waits for the complete Push.
        let pulled = !syncError && !(pushError && (hasPullCorrections || session.bootstrapToken));
        let pulledThrough = serverUpper;
        if (pulled && pushed && pushedCount > 0) {
            // Own pushes land above serverUpper; pull them back so the confirmed Pull range
            // proves this replica knows its own deletions after the server collects them.
            try {
                assertSyncServer(serverUrl);
                const confirmUpper = await getServerNow();
                assertSyncServer(serverUrl);
                const followUp = new Map<string, LocalChange>();
                await this.pullRange(
                    syncScope,
                    serverUrl,
                    session,
                    serverUpper,
                    confirmUpper,
                    followUp
                );
                if (followUp.size === 0) pulledThrough = confirmUpper;
            } catch (err) {
                logger.warn(`Failed to confirm ${syncScope.collection} push`, err);
            }
        }
        if (pulled) {
            try {
                await commitSyncSession(syncScope, serverUrl, session, {
                    cursors,
                    serverUpper: pulledThrough,
                    localUpper,
                    pushed
                });
            } catch (err) {
                // An unconfirmed Pull may have missed deletions the server collected meanwhile.
                pulled = false;
                syncError = err;
                logger.error(`Failed to commit ${syncScope.collection} session`, err);
            }
        }

        const nextPullCursor = pulled && pulledThrough > pullCursor ? pulledThrough : undefined;
        const nextPushCursor = pushed && localUpper > pushCursor ? localUpper : undefined;
        if (nextPullCursor !== undefined || nextPushCursor !== undefined) {
            await syncCursorDB.advance(cursorIdentity, {
                serverPullCursor: nextPullCursor,
                localPushCursor: nextPushCursor
            });
            // Advanced cursors are proven coverage; raise the cached session before GC uses them.
            session.serverCoverage = Math.max(session.serverCoverage, nextPullCursor ?? 0);
            session.localCoverage = Math.max(session.localCoverage, nextPushCursor ?? 0);
        }
        if (pushed) {
            await collectGarbage(syncScope.scope, Math.max(pushCursor, localUpper));
        }

        const failure = syncError ?? pushError;
        if (failure) {
            this.recordRefusal(key, failure);
            throw failure;
        }
    }

    /**
     * Pull (after, through] and merge it. Unknown live records are ingested only while this
     * replica's forgotten deletions stay covered; local winners are queued in `offlineWrites`.
     */
    private async pullRange(
        syncScope: SyncScope,
        serverUrl: string,
        session: SyncSession,
        after: number,
        through: number,
        offlineWrites: Map<string, LocalChange>
    ): Promise<void> {
        const cascadeTargets: Array<{ table: TableName; id: string }> = [];
        // Keyset pages: a row updated mid-Pull leaves the range instead of shifting an offset
        // past an unread row, so the cursor never advances over a change it did not read.
        let readThrough = after;
        while (true) {
            assertSyncServer(serverUrl);
            const result = await pb.collection(syncScope.collection).getList(1, PAGE_SIZE, {
                filter: pb.filter(
                    `${syncScope.ownerField} = {:scopeId} && serverUpdatedAt > {:after} && serverUpdatedAt <= {:through}`,
                    {
                        scopeId: syncScope.scope.scopeId,
                        after: readThrough,
                        through
                    }
                ),
                sort: 'serverUpdatedAt,id',
                skipTotal: true
            });

            if (result.items.length > 0) {
                // A row of another lineage means the server's scope was replaced mid-session.
                if (result.items.some((item) => !ofLineage(item, session.lineage))) {
                    throw new AppError('SYNC_UNSAFE', 'The server replaced this scope');
                }
                const remotes = await Promise.all(
                    result.items.map((serverRecord) =>
                        this.pbToLocalRecord(
                            serverRecord as unknown as Record<string, unknown>,
                            syncScope
                        )
                    )
                );
                for (const remote of remotes) clock.observe(remote.record.updatedAt ?? 0);
                const tables = [...new Set(remotes.map(({ table }) => table))];

                // Read, decide and write in one transaction: a local change committed during the
                // Pull is merged instead of overwritten by a decision made before it.
                const { applied, corrections } = await localDB.transaction(
                    tables,
                    'rw',
                    async () => {
                        const applied: AssetReconciliation[] = [];
                        const corrections: LocalChange[] = [];
                        const writes = new Map<TableName, DataRecord[]>();
                        let ingestsUnknown = false;
                        for (const remote of remotes) {
                            const local = await localDB.getRecord<DataRecord>(
                                remote.table,
                                remote.record.id
                            );
                            const winner = local ? chooseWinner(local, remote.record) : 'remote';
                            if (winner === 'local') {
                                corrections.push({ table: remote.table, record: local! });
                            }
                            if (winner !== 'remote') continue;
                            ingestsUnknown ||= !local && !remote.record.isDeleted;
                            writes.set(remote.table, [
                                ...(writes.get(remote.table) ?? []),
                                remote.record
                            ]);
                            applied.push({
                                table: remote.table,
                                before: local,
                                after: remote.record
                            });
                        }
                        if (ingestsUnknown) {
                            assertIngestCovered(
                                syncScope.scope,
                                await localDB.getSyncGcHigh(syncScope.scope),
                                session.localCoverage
                            );
                        }
                        for (const [table, records] of writes) {
                            await localDB.putRecords(table, records, { origin: 'sync' });
                        }
                        return { applied, corrections };
                    }
                );

                for (const change of corrections) {
                    offlineWrites.set(this.changeKey(change.table, change.record.id), change);
                }
                for (const { table, before, after } of applied) {
                    if (before && after.isDeleted && !before.isDeleted) {
                        cascadeTargets.push({ table, id: after.id });
                    }
                }
                await Promise.all(
                    applied.map(({ table, before, after }) =>
                        this.reconcileAssetRegistry(table, before, after)
                    )
                );
            }

            if (result.items.length < PAGE_SIZE) break;
            readThrough = readServerRevision(result.items[result.items.length - 1]);
        }

        for (const { table, id } of cascadeTargets) {
            const cascadeResult = await cascadeDeleteChildren(table, id, { origin: 'local' });
            await cleanupCascadeAssets(cascadeResult);
        }
    }

    private async collectUnsyncedChanges(
        scope: DataScope,
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<LocalChange[]> {
        const changes: LocalChange[] = [];
        for (const table of SYNC_TABLES) {
            const records = await localDB.getUnsyncedChanges<DataRecord>(
                table,
                scope,
                afterLocalUpdatedAt,
                throughLocalUpdatedAt
            );
            for (const record of records) {
                changes.push({ table, record });
            }
        }
        return changes;
    }

    /**
     * `coverage` lets the server refuse creates that could resurrect a deletion it forgot; it
     * was proven against `serverUrl`, so nothing is sent once the active server differs.
     */
    private async pushChanges(
        syncScope: SyncScope,
        serverUrl: string,
        changes: LocalChange[],
        proof: PushProof,
        continueOnError = true
    ): Promise<void> {
        const owned = changes.filter(({ record }) => belongsToScope(record, syncScope.scope));
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            try {
                // Encoding, sending and merging the response all belong to the replica the
                // proof was taken for: once it is replaced, nothing more of it is sent.
                const sent = await this.mergeInto(syncScope.scope, proof.epoch, async () => {
                    await this.pushChunk(syncScope, serverUrl, chunk, proof);
                    return true;
                });
                if (sent === null) return;
            } catch (err) {
                logger.error(`Failed to push batch to ${syncScope.collection}`, err);
                const error = toSyncSafetyError(err);
                this.recordRefusal(this.sessionKey(syncScope, serverUrl), error);
                if (!continueOnError) {
                    throw error;
                }
            }
        }
    }

    /** Send one batch under `proof` and merge the canonical results it returns. */
    private async pushChunk(
        syncScope: SyncScope,
        serverUrl: string,
        chunk: LocalChange[],
        proof: PushProof
    ): Promise<void> {
        const batch = pb.createBatch();
        for (const change of chunk) {
            const payload = await this.localToPbRecord(change.table, change.record, syncScope);
            batch.collection(syncScope.collection).upsert(payload, {
                headers: {
                    [SYNC_COVERAGE_HEADER]: String(proof.coverage),
                    [SYNC_LINEAGE_HEADER]: proof.lineage,
                    ...(proof.bootstrapToken
                        ? { [SYNC_BOOTSTRAP_HEADER]: proof.bootstrapToken }
                        : {})
                }
            });
        }

        assertSyncServer(serverUrl);
        const results = await batch.send({ requestKey: null });
        const remotes: DecodedRemoteRecord[] = [];
        for (const result of results) {
            if (result.status < 200 || result.status >= 300 || !result.body) continue;
            remotes.push(
                await this.pbToLocalRecord(result.body as Record<string, unknown>, syncScope)
            );
        }
        if (remotes.length === 0) return;
        const tables = [...new Set(remotes.map(({ table }) => table))];
        // As in Pull: decide against the local state committed when writing.
        const reconciliations = await localDB.transaction(tables, 'rw', async () => {
            const applied: AssetReconciliation[] = [];
            for (const remote of remotes) {
                const local = await localDB.getRecord<DataRecord>(remote.table, remote.record.id);
                if (!local || chooseWinner(local, remote.record) !== 'remote') {
                    continue;
                }
                await localDB.putRecord(remote.table, remote.record, {
                    origin: 'sync'
                });
                applied.push({
                    table: remote.table,
                    before: local,
                    after: remote.record
                });
            }
            return applied;
        });
        const cascadeTargets = reconciliations
            .filter(({ before, after }) => after.isDeleted && !before?.isDeleted)
            .map(({ table, after }) => ({ table, id: after.id }));
        for (const { table, before, after } of reconciliations) {
            await this.reconcileAssetRegistry(table, before, after);
        }
        for (const { table, id } of cascadeTargets) {
            const cascadeResult = await cascadeDeleteChildren(table, id, {
                origin: 'local'
            });
            await cleanupCascadeAssets(cascadeResult);
        }
    }

    /**
     * Push outside a full session. Coverage is taken first and the records are read after it:
     * a snapshot read earlier could predate a deletion the coverage already accounts for.
     */
    private async pushChangesForActiveScopes(
        refs: ChangeRef[],
        continueOnError = true
    ): Promise<void> {
        const serverUrl = normalizeUrl(pb.baseUrl);
        const scopes = getActiveSyncScopes(USER_RECORDS_COLLECTION, ROOM_RECORDS_COLLECTION);
        let firstError: unknown = null;
        for (const syncScope of scopes) {
            const key = this.sessionKey(syncScope, serverUrl);
            const coverage = this.verifiedCoverage(syncScope, serverUrl);
            // Held changes keep localUpdatedAt above the Push cursor; the next verified
            // full session sends them. A blocked scope keeps reporting why it is held.
            if (!coverage) {
                firstError ??= this.blocked.get(key) ?? null;
                continue;
            }
            // A watermark above the proof means this replica forgot a deletion the server may
            // not know: send nothing and re-verify.
            if ((await localDB.getSyncGcHigh(syncScope.scope)) > coverage.localCoverage) {
                this.sessions.delete(key);
                void this.trigger();
                continue;
            }
            try {
                await this.pushChanges(
                    syncScope,
                    serverUrl,
                    await this.readChanges(refs),
                    {
                        coverage: coverage.serverCoverage,
                        lineage: coverage.lineage,
                        epoch: coverage.epoch
                    },
                    continueOnError
                );
            } catch (err) {
                firstError ??= err;
            }
        }
        if (firstError && !continueOnError) throw firstError;
    }

    private async readChanges(refs: ChangeRef[]): Promise<LocalChange[]> {
        const records = await Promise.all(
            refs.map(({ table, id }) => localDB.getRecord<DataRecord>(table, id))
        );
        return records.flatMap((record, i) => (record ? [{ table: refs[i].table, record }] : []));
    }

    /**
     * The one gate for Realtime Pull, buffered Push, and Realtime correction Push.
     *
     * Only a scope verified by a full session on this server may merge or send outside that
     * session. Otherwise nothing moves and a full sync, which starts with the handshake, is
     * requested; it recovers every held event and change from the cursors. It is synchronous,
     * so callers capture coverage before reading or receiving the data it authorizes. The
     * coverage is still enforced at the write: by the local watermark check in the same
     * transaction, and by the server's create guard.
     */
    private verifiedCoverage(syncScope: SyncScope, serverUrl: string): SessionCoverage | null {
        const key = this.sessionKey(syncScope, serverUrl);
        const session = this.sessions.get(key);
        if (!session) {
            // A failed attempt waits for the regular triggers instead of retrying per event.
            if (!this.blocked.has(key)) void this.trigger();
            return null;
        }
        return {
            localCoverage: session.localCoverage,
            serverCoverage: session.serverCoverage,
            lineage: session.lineage,
            epoch: this.epoch(syncScope.scope)
        };
    }

    private replicaKey({ scopeType, scopeId }: DataScope): string {
        return `${scopeType}\u0000${scopeId}`;
    }

    private epoch(scope: DataScope): number {
        return this.epochs.get(this.replicaKey(scope)) ?? 0;
    }

    /**
     * Merge into the scope's replica of `epoch`, or drop the merge if that replica has been
     * replaced since: its data belongs to a session or lineage that no longer applies. The
     * merge is registered synchronously with the check, so a replacement waits for it.
     */
    private async mergeInto<T>(
        scope: DataScope,
        epoch: number,
        merge: () => Promise<T>
    ): Promise<T | null> {
        if (this.epoch(scope) !== epoch) return null;
        const key = this.replicaKey(scope);
        const running = merge();
        const merges = this.merges.get(key) ?? new Set<Promise<unknown>>();
        this.merges.set(key, merges);
        merges.add(running);
        try {
            return await running;
        } finally {
            merges.delete(running);
        }
    }

    /**
     * Before the scope's replica is replaced or re-lineaged: later merges authorized for the
     * current one are dropped, and merges already writing finish first. This orders them by
     * awaiting, not by storage transactions.
     */
    /**
     * The scope's local replica is being discarded (a purge): nothing authorized for it may
     * merge or send any more, on any server.
     */
    async discardReplica(scope: DataScope): Promise<void> {
        const suffix = `\u0000${this.replicaKey(scope)}`;
        for (const key of [...this.sessions.keys()]) {
            if (key.endsWith(suffix)) this.sessions.delete(key);
        }
        await this.replaceReplica(scope);
    }

    private async replaceReplica(scope: DataScope): Promise<void> {
        const key = this.replicaKey(scope);
        this.epochs.set(key, this.epoch(scope) + 1);
        await Promise.allSettled(this.merges.get(key) ?? []);
    }

    /** A proven-unsafe or uninitialized scope stops merging until a full sync verifies it. */
    private recordRefusal(key: string, error: unknown): void {
        if (isSafetyError(error)) {
            this.sessions.delete(key);
            this.blocked.set(key, error);
        }
    }

    private sessionKey({ scope }: SyncScope, serverUrl: string): string {
        return this.scopeKey(scope, serverUrl);
    }

    private scopeKey(scope: DataScope, serverUrl: string): string {
        return `${serverUrl}\u0000${this.replicaKey(scope)}`;
    }

    private setConflict(key: string, conflict: SyncConflict | null): void {
        if (conflict) this.conflicts.set(key, conflict);
        else if (!this.conflicts.delete(key)) return;
        this.emitConflicts();
    }

    private emitConflicts(): void {
        const conflicts = [...this.conflicts.values()];
        for (const listener of this.conflictListeners) listener(conflicts);
    }

    protected override getBufferedWrites(
        event: DatabaseWriteEvent
    ): BufferedRecordWrite<TableName>[] {
        if (event.origin !== 'local' || !SYNC_TABLES.includes(event.tableName)) return [];
        if (
            event.operation === 'delete' ||
            event.operation === 'deleteByIndex' ||
            event.operation === 'purge'
        )
            return [];
        return event.ids.map((id) => ({ bucket: event.tableName, id }));
    }

    protected override async pushBufferedWrites(
        writes: BufferedRecordWrite<TableName>[]
    ): Promise<void> {
        if (!isReadyToSync()) return;

        const refs = new Map<string, ChangeRef>();
        for (const write of writes) {
            refs.set(this.changeKey(write.bucket, write.id), { table: write.bucket, id: write.id });
        }
        if (refs.size === 0) return;

        await this.pushChangesForActiveScopes([...refs.values()], false);
    }

    private async handleRealtimeEvent(
        collection: RemoteCollection,
        serverUrl: string,
        e: RealtimeEvent
    ): Promise<void> {
        let verifiedScope: SyncScope | null = null;
        try {
            if (!isReadyToSync()) return;
            // A subscription from a previous server is stale; the active server's Pull covers it.
            if (normalizeUrl(pb.baseUrl) !== serverUrl) return;
            const syncScope = getRealtimeScope(USER_RECORDS_COLLECTION, collection, e.record);
            if (!syncScope) return;
            // Captured on arrival, before any await: the event must not be older than its proof.
            // Unverified: leave the event to the cursor Pull of a verified full session.
            const coverage = this.verifiedCoverage(syncScope, serverUrl);
            if (!coverage) return;
            verifiedScope = syncScope;

            if (!ofLineage(e.record, coverage.lineage)) {
                throw new AppError('SYNC_UNSAFE', 'The server replaced this scope');
            }
            const remote = await this.pbToLocalRecord(e.record, syncScope);
            clock.observe(remote.record.updatedAt ?? 0);

            await this.mergeInto(syncScope.scope, coverage.epoch, async () => {
                const mergeResult = await localDB.transaction(
                    [remote.table],
                    'rw',
                    async (): Promise<RealtimeMergeResult> => {
                        // Nothing merges once this replica forgot a deletion beyond the proof.
                        assertIngestCovered(
                            syncScope.scope,
                            await localDB.getSyncGcHigh(syncScope.scope),
                            coverage.localCoverage
                        );
                        const local = await localDB.getRecord<DataRecord>(
                            remote.table,
                            remote.record.id
                        );
                        // Unknown tombstones are left to the cursor Pull.
                        if (!local && remote.record.isDeleted) {
                            return { assetReconciliation: null, cascadeTarget: null };
                        }
                        const winner = local ? chooseWinner(local, remote.record) : 'remote';
                        if (winner === 'local') {
                            // Local wins: repair the server through the gated Push.
                            void this.pushChangesForActiveScopes([
                                { table: remote.table, id: remote.record.id }
                            ]);
                        }
                        if (winner !== 'remote') {
                            return { assetReconciliation: null, cascadeTarget: null };
                        }
                        await localDB.putRecord(remote.table, remote.record, { origin: 'sync' });
                        return {
                            assetReconciliation: {
                                table: remote.table,
                                before: local,
                                after: remote.record
                            },
                            cascadeTarget:
                                local && remote.record.isDeleted && !local.isDeleted
                                    ? { table: remote.table, id: remote.record.id }
                                    : null
                        };
                    }
                );

                if (mergeResult.cascadeTarget) {
                    const cascadeResult = await cascadeDeleteChildren(
                        mergeResult.cascadeTarget.table,
                        mergeResult.cascadeTarget.id,
                        { origin: 'local' }
                    );
                    await cleanupCascadeAssets(cascadeResult);
                }

                if (mergeResult.assetReconciliation) {
                    await this.reconcileAssetRegistry(
                        mergeResult.assetReconciliation.table,
                        mergeResult.assetReconciliation.before,
                        mergeResult.assetReconciliation.after
                    );
                }
            });
        } catch (err) {
            if (verifiedScope && isErrorCode(err, 'SYNC_UNSAFE')) {
                // Coverage no longer holds: re-verify through a full session.
                this.sessions.delete(this.sessionKey(verifiedScope, serverUrl));
                void this.trigger();
            }
            logger.error(`Realtime event error for ${collection}`, err);
        }
    }

    private async localToPbRecord(
        table: TableName,
        record: DataRecord,
        syncScope: SyncScope
    ): Promise<Record<string, unknown>> {
        const {
            id,
            scopeId: _scopeId,
            scopeType: _scopeType,
            createdAt,
            updatedAt,
            localUpdatedAt: _localUpdatedAt,
            tombstoneAt: _tombstoneAt,
            isDeleted,
            assetEntries,
            ...rest
        } = record;
        const { ciphertext, iv } = await encodeRecordPayload(syncScope.key, JSON.stringify(rest));

        return {
            id,
            [syncScope.ownerField]: syncScope.scope.scopeId,
            kind: table,
            createdAt,
            updatedAt,
            isDeleted,
            assetEntries: assetEntries ? JSON.stringify(assetEntries) : '',
            encryptedData: toBase64(ciphertext),
            encryptedDataIV: toBase64(iv)
        };
    }

    private async pbToLocalRecord(
        pbRecord: Record<string, unknown>,
        syncScope: SyncScope
    ): Promise<DecodedRemoteRecord> {
        const table = this.toTableName(pbRecord.kind);
        const encData = fromBase64(pbRecord.encryptedData as string);
        const encIV = fromBase64(pbRecord.encryptedDataIV as string);
        const json = await decodeRecordPayload(syncScope.key, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as Record<string, unknown>;
        delete payload.localUpdatedAt;
        delete payload.tombstoneAt;
        const isDeleted = Boolean(pbRecord.isDeleted);

        return {
            table,
            record: {
                ...payload,
                id: pbRecord.id as string,
                scopeType: syncScope.scope.scopeType,
                scopeId: syncScope.scope.scopeId,
                createdAt: normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
                updatedAt: normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
                isDeleted,
                assetEntries: isDeleted ? undefined : this.parseAssetEntries(pbRecord.assetEntries)
            } as unknown as DataRecord
        };
    }

    private parseAssetEntries(value: unknown): AssetEntries | undefined {
        if (typeof value !== 'string' || value.length === 0) return undefined;

        try {
            const parsed = JSON.parse(value) as Record<string, unknown>;
            const entries: AssetEntries = {};
            for (const [hash, status] of Object.entries(parsed)) {
                if (status === 'local' || status === 'remote') {
                    entries[hash] = status;
                }
            }
            return Object.keys(entries).length > 0 ? entries : undefined;
        } catch {
            return undefined;
        }
    }

    private toTableName(kind: unknown): TableName {
        if (typeof kind === 'string' && SYNC_TABLES.includes(kind as TableName)) {
            return kind as TableName;
        }
        throw new Error(`Unknown synced record kind: ${String(kind)}`);
    }

    private async reconcileAssetRegistry(
        table: TableName,
        before: DataRecord | undefined,
        after: DataRecord
    ): Promise<void> {
        const beforeEntries = before?.assetEntries ?? {};
        const afterEntries = after.assetEntries ?? {};

        const removed = Object.keys(beforeEntries).filter((hash) => !(hash in afterEntries));
        const remote = Object.entries(afterEntries)
            .filter(([hash, status]) => status === 'remote' && beforeEntries[hash] !== 'remote')
            .map(([hash]) => hash);
        const local = Object.entries(afterEntries)
            .filter(([hash, status]) => status === 'local' && beforeEntries[hash] !== 'local')
            .map(([hash]) => hash);

        await Promise.all([
            ...removed.map((hash) =>
                AssetService.delete({
                    scopeType: after.scopeType,
                    scopeId: after.scopeId,
                    ownerTable: table,
                    ownerId: after.id,
                    hash
                }).catch(() => undefined)
            ),
            ...local.map((hash) =>
                AssetService.markLocal({
                    scopeType: after.scopeType,
                    scopeId: after.scopeId,
                    ownerTable: table,
                    ownerId: after.id,
                    hash
                }).catch(() => undefined)
            ),
            ...remote.map((hash) =>
                AssetService.markRemote({
                    scopeType: after.scopeType,
                    scopeId: after.scopeId,
                    ownerTable: table,
                    ownerId: after.id,
                    hash
                }).catch(() => undefined)
            )
        ]);
    }

    private changeKey(table: TableName, id: string): string {
        return `${table}:${id}`;
    }
}

export const DataRecordSyncEngine = new DataRecordSyncEngineImpl();

/** Delete-wins, then the larger LWW version. Equal versions leave both sides as they are. */
function chooseWinner(local: DataRecord, remote: DataRecord): 'remote' | 'local' | 'equal' {
    if (!!remote.isDeleted !== !!local.isDeleted) return remote.isDeleted ? 'remote' : 'local';
    const remoteAt = remote.updatedAt ?? 0;
    const localAt = local.updatedAt ?? 0;
    if (remoteAt === localAt) return 'equal';
    return remoteAt > localAt ? 'remote' : 'local';
}

/** The server stamps every record with its scope's lineage; one from another lineage is refused. */
function ofLineage(record: unknown, lineage: string): boolean {
    const stamped = (record as { lineage?: unknown } | undefined)?.lineage;
    return stamped === undefined || stamped === lineage;
}

function readServerRevision(record: unknown): number {
    const revision = (record as { serverUpdatedAt?: unknown } | undefined)?.serverUpdatedAt;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned an invalid revision');
    }
    return revision;
}

/** Deflate must precede AES-GCM: ciphertext is incompressible, record JSON is not. */
async function encodeRecordPayload(key: CryptoKey, json: string): Promise<EncryptedData> {
    return encryptBytes(key, deflateSync(strToU8(json)));
}

async function decodeRecordPayload(key: CryptoKey, data: EncryptedData): Promise<string> {
    return strFromU8(inflateSync(await decryptBytes(key, data)));
}
