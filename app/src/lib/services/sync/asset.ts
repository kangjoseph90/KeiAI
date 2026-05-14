/**
 * Asset Sync Engine — KeiAI v3
 *
 * Syncs logical asset metadata by scope and uploads local plaintext cache
 * entries as deterministic ciphertext. Registry is a device-local cache index.
 */

import { clock } from '$lib/utils/clock';
import { pb } from '$lib/adapters/pb';
import { encrypt, decrypt, toBase64, fromBase64, importMasterKey } from '$lib/crypto';
import { getActiveSession, hasActiveSession } from '../session';
import {
    appAsset,
    type AssetFields,
    type AssetKind,
    type AssetRecord,
    type AssetRegistryRecord,
    type AssetStatus
} from '$lib/adapters/asset';
import type { DataScope } from '$lib/adapters/db';
import { appMulti, type MultiRoomDeleteMarkerRecord } from '$lib/adapters/multi';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { AppError, isErrorCode } from '$lib/types/errors';
import { BaseSyncEngine, type SyncStatus } from './base';
import { createLogger } from '$lib/adapters/logger';
import { encryptConvergentAsset, parseFields } from '../asset/util';
import { uploadAsset } from '../asset/remote';
import { Semaphore } from '$lib/utils/semaphore';

// ─── Types ───────────────────────────────────────────────────────────

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

type AssetCollection = 'assets' | 'multi_room_assets';

interface AssetSyncScope {
    scope: DataScope;
    key: CryptoKey;
    collection: AssetCollection;
    ownerField: 'userId' | 'roomId';
}

interface EncryptedAssetPayload {
    kind: AssetKind;
    encKey: string;
}

export interface AssetSyncStatus extends SyncStatus {
    pendingCount: number;
    currentAssetId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const PAGE_SIZE = 200;
const CHUNK_SIZE = 100;
const UPLOAD_CONCURRENCY = 3;
const MAX_DELETE_MARKER_ATTEMPTS = 5;
const USER_ASSETS_COLLECTION: AssetCollection = 'assets';
const ROOM_ASSETS_COLLECTION: AssetCollection = 'multi_room_assets';
const logger = createLogger('sync:asset');

// ─── Engine ──────────────────────────────────────────────────────────

export class AssetSyncEngine extends BaseSyncEngine<AssetSyncStatus> {
    private subscribed = false;
    private currentAssetId: string | null = null;
    private abortController: AbortController | null = null;

    constructor() {
        super({ pendingCount: 0 });
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    override getState(): AssetSyncStatus {
        return {
            ...super.getState(),
            pendingCount: super.getState().pendingCount,
            currentAssetId: this.currentAssetId ?? undefined
        };
    }

    async start(): Promise<void> {
        await this.trigger();
    }

    override stop(): void {
        this.abortController?.abort();
        this.abortController = null;
        this.currentAssetId = null;
        this.updateStatus({ pendingCount: 0, currentAssetId: undefined });
        super.stop();
    }

    async retry(): Promise<void> {
        await this.trigger();
    }

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        await this.unsubscribeRealtime();
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

    async resetCursors(userId: string): Promise<void> {
        await appKV.remove(this.syncKey({ scopeType: 'user', scopeId: userId }));
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const scopes = this.getActiveSyncScopes();

        this.abortController = new AbortController();

        for (const scope of scopes) {
            await this.syncScope(scope);
            if (this.abortController.signal.aborted) return;
        }

        await this.processUploadQueue(scopes);
        if (this.abortController.signal.aborted) return;

        await this.syncRoomDeleteMarkers();

        this.currentAssetId = null;
        this.updateStatus({ currentAssetId: undefined, pendingCount: 0, progress: undefined });
    }

    private getActiveSyncScopes(): AssetSyncScope[] {
        const { userId, masterKey, roomId, roomKey } = getActiveSession();
        const scopes: AssetSyncScope[] = [
            {
                scope: { scopeType: 'user', scopeId: userId },
                key: masterKey,
                collection: USER_ASSETS_COLLECTION,
                ownerField: 'userId'
            }
        ];

        if (roomId && roomKey) {
            scopes.push({
                scope: { scopeType: 'room', scopeId: roomId },
                key: roomKey,
                collection: ROOM_ASSETS_COLLECTION,
                ownerField: 'roomId'
            });
        }

        return scopes;
    }

    // ── Scope Sync ───────────────────────────────────────────────────

    private async syncScope(syncScope: AssetSyncScope): Promise<void> {
        const syncKey = this.syncKey(syncScope.scope);
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let page = 1;
        let syncError: unknown = null;
        let correctionError: unknown = null;
        const offlineWrites = new Map<string, AssetRecord>();

        try {
            while (true) {
                if (this.abortController?.signal.aborted) break;

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

                for (const remote of remotes) {
                    const local = await appAsset.getAsset(remote.id);
                    const remoteAt = remote.updatedAt ?? 0;
                    const localAt = local?.updatedAt ?? 0;

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

        const scannedUnsynced = await appAsset.getAssetsSince(syncScope.scope, lastSyncTime - 1);
        for (const record of scannedUnsynced) {
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

    private async evictLocalCacheIfRemoteChanged(
        local: AssetRecord | undefined,
        remote: AssetRecord
    ): Promise<void> {
        if (remote.isDeleted) {
            await Promise.all([
                appStorage.delete(`assets/${remote.id}`).catch(() => undefined),
                appAsset.deleteRegistry(remote.id, { origin: 'sync' })
            ]);
            return;
        }

        if (!local) return;
        const localFields = parseFields(local);
        const remoteFields = parseFields(remote);
        if (localFields.hash !== remoteFields.hash || localFields.encKey !== remoteFields.encKey) {
            await Promise.all([
                appStorage.delete(`assets/${remote.id}`).catch(() => undefined),
                appAsset.deleteRegistry(remote.id, { origin: 'sync' })
            ]);
        } else {
            await this.syncRegistryIndex(remote.id, remoteFields);
        }
    }

    // ── Realtime ─────────────────────────────────────────────────────

    private async handleRealtimeEvent(
        collection: AssetCollection,
        event: RealtimeEvent
    ): Promise<void> {
        try {
            if (!hasActiveSession()) return;
            const syncScope = this.getRealtimeScope(collection, event.record);
            if (!syncScope) return;

            const remote = await this.pbToLocalRecord(event.record, syncScope);
            const remoteAt = remote.updatedAt ?? 0;
            let shouldEvict = false;

            await appAsset.transaction(['assets', 'assetRegistry'], 'rw', async () => {
                const local = await appAsset.getAsset(remote.id);
                const localAt = local?.updatedAt ?? 0;

                if (!local || remoteAt > localAt) {
                    await appAsset.putAsset(remote, { origin: 'sync' });
                    shouldEvict = remote.isDeleted || this.didRemoteChangeBytes(local, remote);
                } else if (localAt > remoteAt) {
                    void this.pushRecord(local);
                }
            });

            if (shouldEvict) {
                await Promise.all([
                    appStorage.delete(`assets/${remote.id}`).catch(() => undefined),
                    appAsset.deleteRegistry(remote.id, { origin: 'sync' })
                ]);
            }
        } catch (error) {
            logger.error(`Realtime event error for ${collection}`, error);
        }
    }

    private getRealtimeScope(
        collection: AssetCollection,
        record: Record<string, unknown>
    ): AssetSyncScope | null {
        const { userId, masterKey, roomId, roomKey } = getActiveSession();

        if (collection === USER_ASSETS_COLLECTION) {
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

    private didRemoteChangeBytes(local: AssetRecord | undefined, remote: AssetRecord): boolean {
        if (!local) return false;
        const localFields = parseFields(local);
        const remoteFields = parseFields(remote);
        return localFields.hash !== remoteFields.hash || localFields.encKey !== remoteFields.encKey;
    }

    // ── Push (Local → Server) ─────────────────────────────────────────

    async pushRecord(record: AssetRecord, isNew = false, throwOnError = false): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) {
            if (throwOnError) {
                throw new AppError('NOT_AUTHENTICATED', 'Cannot push asset without sync session');
            }
            return;
        }

        for (const syncScope of this.getActiveSyncScopes()) {
            if (this.belongsToScope(record, syncScope.scope)) {
                await this.pushBatch(syncScope, [record], !throwOnError, isNew);
                return;
            }
        }
    }

    private async pushBatch(
        syncScope: AssetSyncScope,
        records: AssetRecord[],
        swallowErrors = true,
        isNew = false
    ): Promise<void> {
        const owned = records.filter((record) => this.belongsToScope(record, syncScope.scope));
        if (owned.length === 0) return;

        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                const payload = await this.localToPbRecord(record, syncScope);
                if (isNew) {
                    batch.collection(syncScope.collection).create(payload);
                } else {
                    batch.collection(syncScope.collection).upsert(payload);
                }
            }
            try {
                await batch.send({ requestKey: null });
            } catch (error) {
                logger.error(`Failed to push batch to ${syncScope.collection}`, error);
                if (!swallowErrors) throw error;
            }
        }
    }

    async pushById(id: string): Promise<void> {
        const record = await appAsset.getAsset(id);
        if (record) void this.pushRecord(record);
    }

    async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId: activeUserId } = getActiveSession();
        if (userId !== activeUserId) return;

        const syncScope = this.getActiveSyncScopes().find(
            (scope) => scope.scope.scopeType === 'user'
        );
        if (!syncScope) return;

        const changed = await appAsset.getAssetsSince(syncScope.scope, sinceInclusive - 1);
        await this.pushBatch(syncScope, changed);
    }

    // ── Upload Queue ─────────────────────────────────────────────────

    private async processUploadQueue(scopes: AssetSyncScope[]): Promise<void> {
        const pendingGroups = await Promise.all(
            scopes.map(async (syncScope) => ({
                syncScope,
                entries: await appAsset.getRegistryByStatus(syncScope.scope, 'local')
            }))
        );
        const pending = pendingGroups.flatMap(({ syncScope, entries }) =>
            entries.map((entry) => ({ syncScope, entry }))
        );

        this.updateStatus({ pendingCount: pending.length, progress: undefined });
        if (pending.length === 0) return;

        const semaphore = new Semaphore(UPLOAD_CONCURRENCY);
        let completed = 0;
        let fatalError: unknown = null;

        await Promise.all(
            pending.map((item) =>
                semaphore.runExclusive(async () => {
                    if (fatalError || this.abortController?.signal.aborted) return;

                    this.currentAssetId = item.entry.id;
                    this.updateStatus({
                        currentAssetId: item.entry.id,
                        progress: {
                            completed,
                            total: pending.length,
                            currentItemId: item.entry.id
                        }
                    });

                    try {
                        await this.uploadOne(item.entry, item.syncScope);
                    } catch (error) {
                        if (this.isQuotaError(error) || this.isAuthError(error)) {
                            fatalError = error;
                            this.abortController?.abort();
                            return;
                        }
                        logger.error(`Failed to sync asset ${item.entry.id}:`, error);
                    } finally {
                        completed++;
                        this.updateStatus({
                            pendingCount: Math.max(pending.length - completed, 0),
                            progress: {
                                completed,
                                total: pending.length,
                                currentItemId: item.entry.id
                            }
                        });
                    }
                })
            )
        );

        if (fatalError) throw fatalError;
    }

    private async uploadOne(entry: AssetRegistryRecord, syncScope: AssetSyncScope): Promise<void> {
        const asset = await appAsset.getAsset(entry.id);
        if (!asset || asset.isDeleted || !this.belongsToScope(asset, syncScope.scope)) {
            await appAsset.deleteRegistry(entry.id).catch(() => undefined);
            return;
        }

        const fields = parseFields(asset);
        if (fields.status !== 'local') {
            await this.syncRegistryIndex(entry.id, fields);
            return;
        }

        const plaintext = await appStorage.read(`assets/${entry.id}`);
        if (!plaintext) return;

        const encrypted = await encryptConvergentAsset(plaintext);
        const nextFields: AssetFields = {
            kind: fields.kind,
            status: 'remote',
            hash: encrypted.hash,
            encKey: encrypted.encKey
        };

        await uploadAsset(encrypted.hash, encrypted.ciphertext);

        const updated: AssetRecord = {
            ...asset,
            data: nextFields as unknown as Record<string, unknown>,
            updatedAt: clock.now()
        };

        await appAsset.putAsset(updated);
        await this.pushBatch(syncScope, [updated], false);
        await this.putRegistryFromAsset(entry, nextFields, plaintext.length);
    }

    private async putRegistryFromAsset(
        existing: AssetRegistryRecord,
        fields: Pick<AssetFields, 'kind' | 'status'>,
        size: number
    ): Promise<void> {
        await appAsset.putRegistry({
            ...existing,
            kind: fields.kind,
            status: fields.status,
            size,
            updatedAt: clock.now()
        });
    }

    private async syncRegistryIndex(
        id: string,
        fields: Pick<AssetFields, 'kind' | 'status'>
    ): Promise<void> {
        const registry = await appAsset.getRegistry(id);
        if (!registry || registry.isDeleted) return;
        if (registry.kind === fields.kind && registry.status === fields.status) return;
        await appAsset.putRegistry({
            ...registry,
            kind: fields.kind,
            status: fields.status,
            updatedAt: clock.now()
        });
    }

    // ── Delete Markers ───────────────────────────────────────────────

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
            const syncScope: AssetSyncScope = {
                scope,
                key: roomKey,
                collection: ROOM_ASSETS_COLLECTION,
                ownerField: 'roomId'
            };
            const changes = (await appAsset.getAssetsSince(scope, 0)).filter(
                (record) => record.isDeleted
            );
            if (changes.length > 0) {
                await this.pushBatch(syncScope, changes, false);
            }
            if (marker.dataDone) {
                await appMulti.deleteDeleteMarker(marker.roomId);
            } else {
                await appMulti.saveDeleteMarker({
                    ...marker,
                    assetDone: true,
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

    // ── Serialization ────────────────────────────────────────────────

    private async localToPbRecord(
        record: AssetRecord,
        syncScope: AssetSyncScope
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
        syncScope: AssetSyncScope
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
            createdAt: this.normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
            updatedAt: this.normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
            isDeleted: Boolean(pbRecord.isDeleted),
            data: fields as unknown as Record<string, unknown>
        };
    }

    private belongsToScope(record: AssetRecord, scope: DataScope): boolean {
        return record.scopeType === scope.scopeType && record.scopeId === scope.scopeId;
    }

    private syncKey(scope: DataScope): string {
        return `lastSync_assets_${scope.scopeType}_${scope.scopeId}`;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;
        if (error instanceof Response) {
            return error.status === 402 || error.status === 413 || error.status === 429;
        }
        const err = error as { status?: number };
        return err?.status === 402 || err?.status === 413 || err?.status === 429;
    }

    protected override isAuthError(error: unknown): boolean {
        if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
            return true;
        }
        if (error instanceof Response) {
            return error.status === 401 || error.status === 403;
        }
        const err = error as { status?: number };
        return err?.status === 401 || err?.status === 403;
    }
}

export const AssetSyncService = new AssetSyncEngine();
