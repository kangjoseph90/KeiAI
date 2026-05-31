/**
 * Asset sync split:
 * - AssetRecordSyncEngine syncs the logical `assets` table metadata.
 * - AssetBinarySyncEngine uploads local plaintext cache entries to the binary endpoint.
 *
 * The binary engine never pushes PocketBase metadata directly. Upload success is
 * represented as a local asset record update, and the record sync engine batches
 * that write like any other record change.
 */

import { pb } from '$lib/adapters/pb';
import { appKV } from '$lib/adapters/kv';
import { appStorage } from '$lib/adapters/storage';
import { encrypt, decrypt, toBase64, fromBase64 } from '$lib/crypto';
import { getActiveSession } from '../../session';
import {
    appAsset,
    type AssetFields,
    type AssetKind,
    type AssetRecord,
    type AssetStatus,
    type AssetWriteEvent
} from '$lib/adapters/asset';
import { BaseRecordSyncEngine, type BufferedRecordWrite } from '../base';
import { createLogger } from '$lib/adapters/logger';
import { clock } from '$lib/utils/clock';
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
} from '../utils';
import { parseFields } from '../../asset/util';
import { type AssetCollection, USER_ASSETS_COLLECTION, ROOM_ASSETS_COLLECTION } from './types';

interface EncryptedAssetPayload {
    kind: AssetKind;
    encKey: string;
}

const logger = createLogger('sync:asset');

export class AssetRecordSyncEngineImpl extends BaseRecordSyncEngine<AssetWriteEvent, 'assets'> {
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
            await pb.collection(USER_ASSETS_COLLECTION).subscribe('*', (event) => {
                void this.handleRealtimeEvent(
                    USER_ASSETS_COLLECTION,
                    event as unknown as RealtimeEvent
                );
            });

            const { roomId, roomKey } = getActiveSession();
            if (roomId && roomKey) {
                await pb.collection(ROOM_ASSETS_COLLECTION).subscribe('*', (event) => {
                    void this.handleRealtimeEvent(
                        ROOM_ASSETS_COLLECTION,
                        event as unknown as RealtimeEvent
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
        for (const collection of [USER_ASSETS_COLLECTION, ROOM_ASSETS_COLLECTION]) {
            try {
                await pb.collection(collection).unsubscribe('*');
            } catch {
                // Already unsubscribed or offline.
            }
        }
        this.subscribed = false;
    }

    async resetCursor(userId: string): Promise<void> {
        await appKV.remove(getSyncKey('assets', 'user', userId));
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;

        const scopes = getActiveSyncScopes(USER_ASSETS_COLLECTION, ROOM_ASSETS_COLLECTION);
        let completed = 0;
        let firstError: unknown = null;

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
            if (result.status === 'rejected') firstError ??= result.reason;
        }
        if (firstError) throw firstError;
    }

    protected override getBufferedWrites(event: AssetWriteEvent): BufferedRecordWrite<'assets'>[] {
        if (event.origin !== 'local') return [];
        if (event.tableName !== 'assets') return [];
        if (event.operation === 'delete') return [];
        return event.ids.map((id) => ({ bucket: 'assets', id }));
    }

    protected override async pushBufferedWrites(
        writes: BufferedRecordWrite<'assets'>[]
    ): Promise<void> {
        if (!isReadyToSync()) return;

        const ids = new Set(writes.map((write) => write.id));
        const records = await Promise.all([...ids].map((id) => appAsset.getAsset(id)));
        const writable = records.filter((record): record is AssetRecord => record !== undefined);
        for (const syncScope of getActiveSyncScopes(
            USER_ASSETS_COLLECTION,
            ROOM_ASSETS_COLLECTION
        )) {
            await this.pushBatch(syncScope, writable);
        }
    }

    private async syncScope(syncScope: SyncScope): Promise<void> {
        const syncKey = getSyncKey('assets', syncScope.scope.scopeType, syncScope.scope.scopeId);
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let page = 1;
        let syncError: unknown = null;
        let correctionError: unknown = null;
        const offlineWrites = new Map<string, AssetRecord>();
        const pulledRemoteIds = new Set<string>();

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

                const remotes = await Promise.all(
                    result.items.map((record) =>
                        this.pbToLocalRecord(
                            record as unknown as Record<string, unknown>,
                            syncScope
                        )
                    )
                );

                const localPairs = await Promise.all(
                    remotes.map(async (remote) => ({
                        remote,
                        local: await appAsset.getAsset(remote.id)
                    }))
                );

                for (const { remote, local } of localPairs) {
                    pulledRemoteIds.add(remote.id);
                    const remoteAt = remote.updatedAt ?? 0;
                    const localAt = local?.updatedAt ?? 0;
                    clock.observe(remoteAt);

                    if (!local || remoteAt > localAt) {
                        await appAsset.putAsset(remote, { origin: 'sync' });
                        await this.evictLocalCacheIfRemoteChanged(local, remote);
                    } else if (localAt > remoteAt) {
                        offlineWrites.set(local.id, local);
                    }
                    nextCursor = Math.max(nextCursor, remoteAt);
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (error) {
            cursorSafeToAdvance = false;
            syncError = error;
            logger.error(`Failed to pull ${syncScope.collection}`, error);
        }

        const scannedUnsynced = await appAsset.getAssetsSince(syncScope.scope, lastSyncTime);
        for (const record of scannedUnsynced) {
            if (pulledRemoteIds.has(record.id)) continue;
            offlineWrites.set(record.id, record);
        }

        if (offlineWrites.size > 0) {
            try {
                await this.pushBatch(syncScope, [...offlineWrites.values()], false);
                for (const record of offlineWrites.values()) {
                    nextCursor = Math.max(nextCursor, record.updatedAt ?? 0);
                }
            } catch (error) {
                correctionError = error;
            }
        }

        if (cursorSafeToAdvance && !correctionError && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        if (syncError) throw syncError;
        if (correctionError) throw correctionError;
    }

    private async handleRealtimeEvent(
        collection: AssetCollection,
        event: RealtimeEvent
    ): Promise<void> {
        try {
            if (!isReadyToSync()) return;
            const syncScope = getRealtimeScope(USER_ASSETS_COLLECTION, collection, event.record);
            if (!syncScope) return;

            const remote = await this.pbToLocalRecord(event.record, syncScope);
            const remoteAt = remote.updatedAt ?? 0;
            clock.observe(remoteAt);
            let shouldEvict = false;

            await appAsset.transaction(['assets', 'assetRegistry'], 'rw', async () => {
                const local = await appAsset.getAsset(remote.id);
                const localAt = local?.updatedAt ?? 0;

                if (!local || remoteAt > localAt) {
                    await appAsset.putAsset(remote, { origin: 'sync' });
                    shouldEvict = remote.isDeleted || this.didRemoteChangeBytes(local, remote);
                } else if (localAt > remoteAt) {
                    void this.pushBatch(syncScope, [local]);
                }
            });

            if (shouldEvict) {
                await this.evictAssetCache(remote.id);
            }
        } catch (error) {
            logger.error(`Realtime event error for ${collection}`, error);
        }
    }

    private async pushBatch(
        syncScope: SyncScope,
        records: AssetRecord[],
        continueOnError = true
    ): Promise<void> {
        const owned = records.filter((record) => belongsToScope(record, syncScope.scope));
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                const payload = await this.localToPbRecord(record, syncScope);
                batch.collection(syncScope.collection).upsert(payload);
            }
            try {
                await batch.send({ requestKey: null });
            } catch (error) {
                logger.error(`Failed to push batch to ${syncScope.collection}`, error);
                if (!continueOnError) throw error;
            }
        }
    }

    private async evictAssetCache(id: string): Promise<void> {
        await Promise.all([
            appStorage.delete(`assets/${id}`).catch(() => undefined),
            appAsset.deleteRegistry(id, { origin: 'sync' })
        ]);
    }

    private async evictLocalCacheIfRemoteChanged(
        local: AssetRecord | undefined,
        remote: AssetRecord
    ): Promise<void> {
        if (remote.isDeleted) {
            await this.evictAssetCache(remote.id);
            return;
        }

        if (!local) return;
        if (this.didRemoteChangeBytes(local, remote)) {
            await this.evictAssetCache(remote.id);
        }
    }

    private didRemoteChangeBytes(local: AssetRecord | undefined, remote: AssetRecord): boolean {
        if (!local) return false;
        const localFields = parseFields(local);
        const remoteFields = parseFields(remote);
        return localFields.hash !== remoteFields.hash || localFields.encKey !== remoteFields.encKey;
    }

    private async localToPbRecord(
        record: AssetRecord,
        syncScope: SyncScope
    ): Promise<Record<string, unknown>> {
        const fields = parseFields(record);
        const payload: EncryptedAssetPayload = {
            kind: fields.kind,
            encKey: fields.encKey
        };
        const { ciphertext, iv } = await encrypt(syncScope.key, JSON.stringify(payload));

        return {
            id: record.id,
            [syncScope.ownerField]: syncScope.scope.scopeId,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            isDeleted: record.isDeleted,
            hash: fields.hash,
            status: fields.status,
            encryptedData: toBase64(ciphertext),
            encryptedDataIV: toBase64(iv)
        };
    }

    private async pbToLocalRecord(
        pbRecord: Record<string, unknown>,
        syncScope: SyncScope
    ): Promise<AssetRecord> {
        const encData = fromBase64(pbRecord.encryptedData as string);
        const encIV = fromBase64(pbRecord.encryptedDataIV as string);
        const json = await decrypt(syncScope.key, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as EncryptedAssetPayload;

        const fields: AssetFields = {
            kind: payload.kind,
            encKey: payload.encKey,
            hash: pbRecord.hash as string,
            status: pbRecord.status as AssetStatus
        };

        return {
            id: pbRecord.id as string,
            scopeType: syncScope.scope.scopeType,
            scopeId: syncScope.scope.scopeId,
            createdAt: normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
            updatedAt: normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
            isDeleted: Boolean(pbRecord.isDeleted),
            data: fields as unknown as Record<string, unknown>
        };
    }
}

export const AssetRecordSyncEngine = new AssetRecordSyncEngineImpl();
