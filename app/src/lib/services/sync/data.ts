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
import { encrypt, decrypt, toBase64, fromBase64 } from '$lib/crypto';
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
import { BaseRecordSyncEngine, type BufferedRecordWrite } from './base';
import { createLogger } from '$lib/adapters/logger';
import { clock } from '$lib/utils/clock';
import { AssetService } from '$lib/services/asset';
import {
    normalizeTimestamp,
    PAGE_SIZE,
    CHUNK_SIZE,
    belongsToScope,
    getSyncKey,
    getActiveSyncScopes,
    getRealtimeScope,
    type SyncScope,
    type RealtimeEvent,
    isReadyToSync
} from './utils';
import type { AssetEntries } from '$lib/types/asset';

type RemoteCollection = 'records' | 'multi_room_records';

interface LocalChange {
    table: TableName;
    record: DataRecord;
}

interface DecodedRemoteRecord {
    table: TableName;
    record: DataRecord;
}

interface AssetReconciliation {
    table: TableName;
    before: DataRecord | undefined;
    after: DataRecord;
}

const logger = createLogger('sync:data');
const USER_RECORDS_COLLECTION: RemoteCollection = 'records';
const ROOM_RECORDS_COLLECTION: RemoteCollection = 'multi_room_records';

export class DataRecordSyncEngineImpl extends BaseRecordSyncEngine<DatabaseWriteEvent, TableName> {
    private subscribed = false;

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async subscribeRealtime(): Promise<void> {
        if (!isReadyToSync()) return;

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

    /**
     * Wipe the user-scope data cursor.
     * Call this when there is no existing local user record so the next syncAll()
     * fetches everything from scratch.
     */
    async resetCursor(userId: string): Promise<void> {
        await appKV.remove(getSyncKey('records', 'user', userId));
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;

        let firstError: unknown = null;
        let completed = 0;
        const scopes = getActiveSyncScopes(USER_RECORDS_COLLECTION, ROOM_RECORDS_COLLECTION);

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

        for (const result of results) {
            if (result.status === 'rejected') {
                firstError ??= result.reason;
            }
        }

        if (firstError) {
            throw firstError;
        }
    }

    private async syncScope(syncScope: SyncScope): Promise<void> {
        const syncKey = getSyncKey('records', syncScope.scope.scopeType, syncScope.scope.scopeId);
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let syncError: unknown = null;
        let correctionError: unknown = null;
        let page = 1;
        const offlineWrites = new Map<string, LocalChange>();

        try {
            while (true) {
                const result = await pb.collection(syncScope.collection).getList(page, PAGE_SIZE, {
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

                    const assetReconciliations: Array<{
                        table: TableName;
                        before: DataRecord | undefined;
                        after: DataRecord;
                    }> = [];

                    for (const { remote, local } of pairedRecords) {
                        const remoteAt = remote.record.updatedAt ?? 0;
                        const localAt = local?.updatedAt ?? 0;
                        clock.observe(remoteAt);

                        if (!local || remoteAt > localAt) {
                            const records = grouped.get(remote.table) ?? [];
                            records.push(remote.record);
                            grouped.set(remote.table, records);
                            assetReconciliations.push({
                                table: remote.table,
                                before: local,
                                after: remote.record
                            });
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
                    await Promise.all(
                        assetReconciliations.map(({ table, before, after }) =>
                            this.reconcileAssetRegistry(table, before, after)
                        )
                    );
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (err) {
            cursorSafeToAdvance = false;
            syncError = err;
            logger.error(`Failed to pull ${syncScope.collection}`, err);
        }

        const scannedUnsynced = await this.collectUnsyncedChanges(syncScope.scope, lastSyncTime);
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

    private async pushChanges(
        syncScope: SyncScope,
        changes: LocalChange[],
        continueOnError = true
    ): Promise<void> {
        const owned = changes.filter(({ record }) => belongsToScope(record, syncScope.scope));
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const change of chunk) {
                const payload = await this.localToPbRecord(change.table, change.record, syncScope);
                batch.collection(syncScope.collection).upsert(payload);
            }

            try {
                await batch.send({ requestKey: null });
            } catch (err) {
                logger.error(`Failed to push batch to ${syncScope.collection}`, err);
                if (!continueOnError) {
                    throw err;
                }
            }
        }
    }

    private async pushChangesForActiveScopes(
        changes: LocalChange[],
        continueOnError = true
    ): Promise<void> {
        const scopes = getActiveSyncScopes(USER_RECORDS_COLLECTION, ROOM_RECORDS_COLLECTION);
        for (const syncScope of scopes) {
            await this.pushChanges(syncScope, changes, continueOnError);
        }
    }

    protected override getBufferedWrites(
        event: DatabaseWriteEvent
    ): BufferedRecordWrite<TableName>[] {
        if (event.origin !== 'local' || !SYNC_TABLES.includes(event.tableName)) return [];
        if (event.operation === 'delete' || event.operation === 'deleteByIndex') return [];
        return event.ids.map((id) => ({ bucket: event.tableName, id }));
    }

    protected override async pushBufferedWrites(
        writes: BufferedRecordWrite<TableName>[]
    ): Promise<void> {
        if (!isReadyToSync()) return;

        const byTable = new Map<TableName, Set<string>>();
        for (const write of writes) {
            const ids = byTable.get(write.bucket) ?? new Set<string>();
            ids.add(write.id);
            byTable.set(write.bucket, ids);
        }

        const changes: LocalChange[] = [];
        for (const [tableName, ids] of byTable) {
            const records = await Promise.all(
                [...ids].map((id) => localDB.getRecord<DataRecord>(tableName, id))
            );
            for (const record of records) {
                if (record) changes.push({ table: tableName, record });
            }
        }
        if (changes.length === 0) return;

        await this.pushChangesForActiveScopes(changes);
    }

    private async handleRealtimeEvent(
        collection: RemoteCollection,
        e: RealtimeEvent
    ): Promise<void> {
        try {
            if (!isReadyToSync()) return;
            const syncScope = getRealtimeScope(USER_RECORDS_COLLECTION, collection, e.record);
            if (!syncScope) return;

            const remote = await this.pbToLocalRecord(e.record, syncScope);
            const remoteAt = remote.record.updatedAt ?? 0;
            clock.observe(remoteAt);

            const assetReconciliation = await localDB.transaction(
                [remote.table],
                'rw',
                async (): Promise<AssetReconciliation | null> => {
                    const local = await localDB.getRecord<DataRecord>(
                        remote.table,
                        remote.record.id
                    );
                    const localAt = local?.updatedAt ?? 0;

                    if (!local || remoteAt > localAt) {
                        await localDB.putRecord(remote.table, remote.record, { origin: 'sync' });
                        return {
                            table: remote.table,
                            before: local,
                            after: remote.record
                        };
                    } else if (remoteAt < localAt) {
                        void this.pushChangesForActiveScopes([
                            { table: remote.table, record: local }
                        ]);
                    }

                    return null;
                }
            );

            if (assetReconciliation) {
                await this.reconcileAssetRegistry(
                    assetReconciliation.table,
                    assetReconciliation.before,
                    assetReconciliation.after
                );
            }
        } catch (err) {
            logger.error(`Realtime event error for ${collection}`, err);
        }
    }

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
            assetEntries,
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
        const json = await decrypt(syncScope.key, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as Record<string, unknown>;
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
