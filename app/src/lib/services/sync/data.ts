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
    type DatabaseWriteEvent
} from '$lib/adapters/db';
import { syncCursorDB } from '$lib/adapters/sync';
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
    isSafetyError,
    openSyncSession,
    SYNC_COVERAGE_HEADER,
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

type SessionCoverage = Pick<SyncSession, 'localCoverage' | 'serverCoverage'>;

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
const USER_RECORDS_COLLECTION: RemoteCollection = 'records';
const ROOM_RECORDS_COLLECTION: RemoteCollection = 'multi_room_records';

export class DataRecordSyncEngineImpl extends BaseRecordSyncEngine<DatabaseWriteEvent, TableName> {
    private subscribed = false;
    /** Verified H–C sessions per server and scope; their coverage facts never expire. */
    private readonly sessions = new Map<string, SyncSession>();
    /** Last session failure of an unverified server scope; regular sync triggers retry it. */
    private readonly blocked = new Map<string, unknown>();

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

    private async syncScope(
        syncScope: SyncScope,
        serverUrl: string,
        localUpper: number,
        serverUpper: number
    ): Promise<void> {
        const { userId } = getActiveSession();
        const cursorIdentity = getSyncCursorIdentity('records', userId, syncScope.scope);
        const cursors = await syncCursorDB.get(cursorIdentity);
        const pullCursor = cursors.serverPullCursor;
        const pushCursor = cursors.localPushCursor;
        const key = this.sessionKey(syncScope, serverUrl);
        // Refuse before any data moves when GC may have forgotten a deletion the peer lacks.
        let session: SyncSession;
        try {
            session = await openSyncSession(syncScope, serverUrl, cursors);
        } catch (err) {
            this.blocked.set(key, err);
            throw err;
        }
        this.sessions.set(key, session);
        this.blocked.delete(key);
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
                    session.serverCoverage,
                    false
                );
            }
        } catch (err) {
            pushError = err;
        }

        const pushed = !pushError;
        let pulled = !syncError && !(pushError && hasPullCorrections);
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
        coverage: number,
        continueOnError = true
    ): Promise<void> {
        const owned = changes.filter(({ record }) => belongsToScope(record, syncScope.scope));
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const change of chunk) {
                const payload = await this.localToPbRecord(change.table, change.record, syncScope);
                batch.collection(syncScope.collection).upsert(payload, {
                    headers: { [SYNC_COVERAGE_HEADER]: String(coverage) }
                });
            }

            try {
                assertSyncServer(serverUrl);
                const results = await batch.send({ requestKey: null });
                const remotes: DecodedRemoteRecord[] = [];
                for (const result of results) {
                    if (result.status < 200 || result.status >= 300 || !result.body) continue;
                    remotes.push(
                        await this.pbToLocalRecord(
                            result.body as Record<string, unknown>,
                            syncScope
                        )
                    );
                }
                const tables = [...new Set(remotes.map(({ table }) => table))];
                // As in Pull: decide against the local state committed when writing.
                const reconciliations =
                    remotes.length === 0
                        ? []
                        : await localDB.transaction(tables, 'rw', async () => {
                              const applied: AssetReconciliation[] = [];
                              for (const remote of remotes) {
                                  const local = await localDB.getRecord<DataRecord>(
                                      remote.table,
                                      remote.record.id
                                  );
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
                    coverage.serverCoverage,
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
        return { localCoverage: session.localCoverage, serverCoverage: session.serverCoverage };
    }

    /** A proven-unsafe or uninitialized scope stops merging until a full sync verifies it. */
    private recordRefusal(key: string, error: unknown): void {
        if (isSafetyError(error)) {
            this.sessions.delete(key);
            this.blocked.set(key, error);
        }
    }

    private sessionKey({ scope }: SyncScope, serverUrl: string): string {
        return `${serverUrl}\u0000${scope.scopeType}\u0000${scope.scopeId}`;
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

            const remote = await this.pbToLocalRecord(e.record, syncScope);
            clock.observe(remote.record.updatedAt ?? 0);

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
