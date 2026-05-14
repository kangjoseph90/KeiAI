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
import { getActiveSession, hasActiveSession } from '../session';
import { encrypt, decrypt, toBase64, fromBase64, importMasterKey } from '$lib/crypto';
import {
    localDB,
    type TableName,
    SYNC_TABLES,
    type BaseRecord,
    type DataRecord,
    type DataScope,
    type DatabaseWriteEvent
} from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';
import { appMulti, type MultiRoomDeleteMarkerRecord } from '$lib/adapters/multi';
import { BaseSyncEngine } from './base';
import { createLogger } from '$lib/adapters/logger';
import { isErrorCode } from '$lib/types/errors';
import { clock } from '$lib/utils/clock';

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

type RemoteCollection = 'records' | 'multi_room_records';

interface SyncScope {
    scope: DataScope;
    key: CryptoKey;
    collection: RemoteCollection;
    ownerField: 'userId' | 'roomId';
}

interface LocalChange {
    table: TableName;
    record: DataRecord;
}

interface DecodedRemoteRecord {
    table: TableName;
    record: DataRecord;
}

const logger = createLogger('sync:data');
const USER_RECORDS_COLLECTION: RemoteCollection = 'records';
const ROOM_RECORDS_COLLECTION: RemoteCollection = 'multi_room_records';
const MAX_DELETE_MARKER_ATTEMPTS = 5;

export class DataSyncEngine extends BaseSyncEngine {
    // ─── State ────────────────────────────────────────────────────────
    private subscribed = false;
    private syncing = false;
    private pendingQueue: Array<() => Promise<void>> = [];

    private readonly PAGE_SIZE = 200;
    private readonly CHUNK_SIZE = 100;

    constructor() {
        super();
    }

    // ─── Realtime Subscriptions ───────────────────────────────────────

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        await this.unsubscribeRealtime();

        try {
            await pb.collection(USER_RECORDS_COLLECTION).subscribe('*', (e) => {
                void this.handleRealtimeEvent(
                    USER_RECORDS_COLLECTION,
                    e as unknown as RealtimeEvent
                );
            });

            const { roomId, roomKey } = getActiveSession();
            if (roomId && roomKey) {
                await pb.collection(ROOM_RECORDS_COLLECTION).subscribe('*', (e) => {
                    void this.handleRealtimeEvent(
                        ROOM_RECORDS_COLLECTION,
                        e as unknown as RealtimeEvent
                    );
                });
            }
        } catch (err) {
            await this.unsubscribeRealtime();
            throw err;
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

    // ─── Cursor Management ───────────────────────────────────────────

    /**
     * Wipe the user-scope data cursor.
     * Call this when there is no existing local user record so the next syncAll()
     * fetches everything from scratch.
     */
    async resetCursors(userId: string): Promise<void> {
        await appKV.remove(this.syncKey({ scopeType: 'user', scopeId: userId }));
    }

    // ─── Catch-up Pull (boot + fallback poll) ─────────────────────────

    async syncAll(): Promise<void> {
        await this.trigger();
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        this.syncing = true;
        let firstError: unknown = null;
        let completed = 0;
        const scopes = this.getActiveSyncScopes();

        try {
            const results = await Promise.allSettled(
                scopes.map(async (scope) => {
                    await this.syncScope(scope);
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

            await this.syncRoomDeleteMarkers();

            for (const result of results) {
                if (result.status === 'rejected') {
                    firstError ??= result.reason;
                }
            }
        } finally {
            this.syncing = false;
            void this.flushPendingQueue();
        }

        if (firstError) {
            throw firstError;
        }
    }

    private getActiveSyncScopes(): SyncScope[] {
        const { userId, masterKey, roomId, roomKey } = getActiveSession();
        const scopes: SyncScope[] = [
            {
                scope: { scopeType: 'user', scopeId: userId },
                key: masterKey,
                collection: USER_RECORDS_COLLECTION,
                ownerField: 'userId'
            }
        ];

        if (roomId && roomKey) {
            scopes.push({
                scope: { scopeType: 'room', scopeId: roomId },
                key: roomKey,
                collection: ROOM_RECORDS_COLLECTION,
                ownerField: 'roomId'
            });
        }

        return scopes;
    }

    /** Flush all push tasks queued during a syncAll run. */
    private async flushPendingQueue(): Promise<void> {
        const tasks = this.pendingQueue.splice(0);
        for (const task of tasks) {
            await task();
        }
    }

    private async syncScope(syncScope: SyncScope): Promise<void> {
        const syncKey = this.syncKey(syncScope.scope);
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let syncError: unknown = null;
        let correctionError: unknown = null;
        let page = 1;
        const offlineWrites = new Map<string, LocalChange>();

        try {
            while (true) {
                const result = await pb
                    .collection(syncScope.collection)
                    .getList(page, this.PAGE_SIZE, {
                        filter: pb.filter(
                            `${syncScope.ownerField} = {:scopeId} && updatedAt >= {:since}`,
                            {
                                scopeId: syncScope.scope.scopeId,
                                since: lastSyncTime
                            }
                        ),
                        sort: 'updatedAt'
                    });

                if (result.items.length > 0) {
                    const grouped = new Map<TableName, DataRecord[]>();

                    const remotes = await Promise.all(
                        result.items.map((serverRecord) =>
                            this.pbToLocalRecord(
                                serverRecord as unknown as Record<string, unknown>,
                                syncScope
                            )
                        )
                    );

                    const pairedRecords = await Promise.all(
                        remotes.map(async (remote) => ({
                            remote,
                            local: await localDB.getRecord<DataRecord>(
                                remote.table,
                                remote.record.id
                            )
                        }))
                    );

                    for (const { remote, local } of pairedRecords) {
                        const remoteAt = remote.record.updatedAt ?? 0;
                        const localAt = local?.updatedAt ?? 0;

                        if (!local || remoteAt > localAt) {
                            const records = grouped.get(remote.table) ?? [];
                            records.push(remote.record);
                            grouped.set(remote.table, records);
                        } else if (remoteAt < localAt) {
                            offlineWrites.set(this.changeKey(remote.table, local.id), {
                                table: remote.table,
                                record: local
                            });
                        }
                        nextCursor = Math.max(nextCursor, remoteAt);
                    }

                    for (const [table, records] of grouped) {
                        await localDB.putRecords(table, records, { origin: 'sync' });
                    }
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (err) {
            cursorSafeToAdvance = false;
            syncError = err;
            logger.error(`Failed to pull ${syncScope.collection}`, err);
        }

        const scannedUnsynced = await this.collectUnsyncedChanges(
            syncScope.scope,
            lastSyncTime - 1
        );
        for (const change of scannedUnsynced) {
            offlineWrites.set(this.changeKey(change.table, change.record.id), change);
        }

        const unsynced = [...offlineWrites.values()];
        if (unsynced.length > 0) {
            try {
                await this.pushChanges(syncScope, unsynced, false);
                for (const { record } of unsynced) {
                    nextCursor = Math.max(nextCursor, record.updatedAt ?? 0);
                }
            } catch (err) {
                correctionError = err;
            }
        }

        if (cursorSafeToAdvance && !correctionError && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        if (syncError) {
            throw syncError;
        }

        if (correctionError) {
            throw correctionError;
        }
    }

    // ─── Push ────────────────────────────────────────────────────────

    private async collectUnsyncedChanges(
        scope: DataScope,
        sinceUpdatedAt: number
    ): Promise<LocalChange[]> {
        const changes: LocalChange[] = [];
        for (const table of SYNC_TABLES) {
            const records = await localDB.getUnsyncedChanges<DataRecord>(
                table,
                scope,
                sinceUpdatedAt
            );
            for (const record of records) {
                changes.push({ table, record });
            }
        }
        return changes;
    }

    private async collectDeletedChanges(scope: DataScope): Promise<LocalChange[]> {
        const changes = await this.collectUnsyncedChanges(scope, 0);
        return changes.filter(({ record }) => record.isDeleted);
    }

    private async pushChanges(
        syncScope: SyncScope,
        changes: LocalChange[],
        swallowErrors = true,
        isNew = false
    ): Promise<void> {
        const owned = changes.filter(
            ({ record }) =>
                record.scopeType === syncScope.scope.scopeType &&
                record.scopeId === syncScope.scope.scopeId
        );
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += this.CHUNK_SIZE) {
            const chunk = owned.slice(i, i + this.CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const change of chunk) {
                const payload = await this.localToPbRecord(change.table, change.record, syncScope);
                if (isNew) {
                    batch.collection(syncScope.collection).create(payload);
                } else {
                    batch.collection(syncScope.collection).upsert(payload);
                }
            }

            try {
                await batch.send({ requestKey: null });
            } catch (err) {
                logger.error(`Failed to push batch to ${syncScope.collection}`, err);
                if (!swallowErrors) {
                    throw err;
                }
            }
        }
    }

    private async pushChangesForActiveScopes(
        changes: LocalChange[],
        swallowErrors = true,
        isNew = false
    ): Promise<void> {
        const scopes = this.getActiveSyncScopes();
        for (const syncScope of scopes) {
            await this.pushChanges(syncScope, changes, swallowErrors, isNew);
        }
    }

    async pushRecord(tableName: TableName, record: BaseRecord, isNew = false): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        await this.pushChangesForActiveScopes(
            [{ table: tableName, record: record as DataRecord }],
            true,
            isNew
        );
    }

    async pushById(tableName: TableName, id: string): Promise<void> {
        const record = await localDB.getRecord<DataRecord>(tableName, id);
        if (record) void this.pushRecord(tableName, record);
    }

    async handleLocalWrite(event: DatabaseWriteEvent): Promise<void> {
        if (event.origin !== 'local' || !SYNC_TABLES.includes(event.tableName)) return;
        if (event.operation === 'delete' || event.operation === 'deleteByIndex') return;
        if (event.ids.length === 0) return;

        const task = () => this.pushIds(event.tableName, event.ids);
        if (this.syncing) {
            this.pendingQueue.push(task);
        } else {
            void task();
        }
    }

    private async pushIds(tableName: TableName, ids: string[]): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const records = await Promise.all(
            ids.map((id) => localDB.getRecord<DataRecord>(tableName, id))
        );
        const changes = records
            .filter((record): record is DataRecord => record !== undefined)
            .map((record) => ({ table: tableName, record }));
        if (changes.length === 0) return;

        await this.pushChangesForActiveScopes(changes);
    }

    async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId: activeUserId } = getActiveSession();
        if (userId !== activeUserId) return;

        const changes = await this.collectUnsyncedChanges(
            { scopeType: 'user', scopeId: userId },
            sinceInclusive - 1
        );
        await this.pushChangesForActiveScopes(changes);
    }

    private async syncRoomDeleteMarkers(): Promise<void> {
        const markers = await appMulti.getDeleteMarkers();
        for (const marker of markers) {
            await this.syncRoomDeleteMarker(marker);
        }
    }

    private async syncRoomDeleteMarker(marker: MultiRoomDeleteMarkerRecord): Promise<void> {
        if (marker.attempts >= MAX_DELETE_MARKER_ATTEMPTS) return;

        const scope: DataScope = { scopeType: 'room', scopeId: marker.roomId };
        const rawRoomKey = fromBase64(marker.roomKey);

        try {
            const roomKey = await importMasterKey(rawRoomKey, true);
            const syncScope: SyncScope = {
                scope,
                key: roomKey,
                collection: ROOM_RECORDS_COLLECTION,
                ownerField: 'roomId'
            };
            const changes = await this.collectDeletedChanges(scope);
            if (changes.length > 0) {
                await this.pushChanges(syncScope, changes, false);
            }
            if (marker.assetDone) {
                await appMulti.deleteDeleteMarker(marker.roomId);
            } else {
                await appMulti.saveDeleteMarker({
                    ...marker,
                    dataDone: true,
                    updatedAt: clock.now(),
                    lastError: undefined
                });
            }
        } catch (error) {
            await appMulti.saveDeleteMarker({
                ...marker,
                attempts: marker.attempts + 1,
                updatedAt: clock.now(),
                lastError: error instanceof Error ? error.message : String(error)
            });
        } finally {
            rawRoomKey.fill(0);
        }
    }

    // ─── Realtime Event Handler ───────────────────────────────────────

    private async handleRealtimeEvent(
        collection: RemoteCollection,
        e: RealtimeEvent
    ): Promise<void> {
        try {
            if (!hasActiveSession()) return;
            const syncScope = this.getRealtimeScope(collection, e.record);
            if (!syncScope) return;

            const remote = await this.pbToLocalRecord(e.record, syncScope);
            const remoteAt = remote.record.updatedAt ?? 0;

            await localDB.transaction([remote.table], 'rw', async () => {
                const local = await localDB.getRecord<DataRecord>(remote.table, remote.record.id);
                const localAt = local?.updatedAt ?? 0;

                if (!local || remoteAt > localAt) {
                    await localDB.putRecord(remote.table, remote.record, { origin: 'sync' });
                } else if (remoteAt < localAt) {
                    void this.pushRecord(remote.table, local);
                }
            });
        } catch (err) {
            logger.error(`Realtime event error for ${collection}`, err);
        }
    }

    private getRealtimeScope(
        collection: RemoteCollection,
        record: Record<string, unknown>
    ): SyncScope | null {
        const { userId, masterKey, roomId, roomKey } = getActiveSession();

        if (collection === USER_RECORDS_COLLECTION) {
            if (record.userId !== userId) return null;
            return {
                scope: { scopeType: 'user', scopeId: userId },
                key: masterKey,
                collection,
                ownerField: 'userId'
            };
        }

        if (!roomId || !roomKey || record.roomId !== roomId) return null;
        return {
            scope: { scopeType: 'room', scopeId: roomId },
            key: roomKey,
            collection,
            ownerField: 'roomId'
        };
    }

    // ─── Serialization ────────────────────────────────────────────────

    private async localToPbRecord(
        table: TableName,
        record: BaseRecord,
        syncScope: SyncScope
    ): Promise<Record<string, unknown>> {
        const {
            id,
            scopeId: _scopeId,
            scopeType: _scopeType,
            createdAt,
            updatedAt,
            isDeleted,
            ...rest
        } = record;
        const { ciphertext, iv } = await encrypt(syncScope.key, JSON.stringify(rest));

        return {
            id,
            [syncScope.ownerField]: syncScope.scope.scopeId,
            kind: table,
            createdAt,
            updatedAt,
            isDeleted,
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
        const json = await decrypt(syncScope.key, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as Record<string, unknown>;

        return {
            table,
            record: {
                ...payload,
                id: pbRecord.id as string,
                scopeType: syncScope.scope.scopeType,
                scopeId: syncScope.scope.scopeId,
                createdAt: this.normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
                updatedAt: this.normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
                isDeleted: Boolean(pbRecord.isDeleted)
            } as unknown as DataRecord
        };
    }

    private toTableName(kind: unknown): TableName {
        if (typeof kind === 'string' && SYNC_TABLES.includes(kind as TableName)) {
            return kind as TableName;
        }
        throw new Error(`Unknown synced record kind: ${String(kind)}`);
    }

    private syncKey(scope: DataScope): string {
        return `lastSync_records_${scope.scopeType}_${scope.scopeId}`;
    }

    private changeKey(table: TableName, id: string): string {
        return `${table}:${id}`;
    }

    protected override isAuthError(error: unknown): boolean {
        if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
            return true;
        }

        const status = (error as { status?: unknown })?.status;
        return status === 401 || status === 403;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;

        const status = (error as { status?: unknown })?.status;
        return status === 402 || status === 413;
    }
}

export const DataSyncService = new DataSyncEngine();
