/**
 * Asset Sync Engine — KeiAI v3
 *
 * Syncs logical asset metadata and uploads local plaintext cache entries as
 * deterministic ciphertext. Registry is a device-local cache index only.
 */

import { clock } from '$lib/utils/clock';
import { pb } from '$lib/adapters/pb';
import { encrypt, decrypt, toBase64, fromBase64 } from '$lib/crypto';
import { getActiveSession, hasActiveSession } from '../user';
import {
    appAsset,
    type AssetFields,
    type AssetKind,
    type AssetRecord,
    type AssetRegistryRecord,
    type AssetStatus
} from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { AppError, isErrorCode } from '$lib/types/errors';
import { BaseSyncEngine, type SyncStatus } from './base';
import { createLogger } from '$lib/adapters/logger';
import { encryptConvergentAsset, parseFields } from '../asset/util';
import { uploadAsset } from '../asset/remote';

// ─── Types ───────────────────────────────────────────────────────────

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

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
const SYNC_KEY_PREFIX = 'lastSync_assets_';
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
        await pb.collection('assets').subscribe('*', (event) => {
            void this.handleRealtimeEvent(event as unknown as RealtimeEvent);
        });
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
        try {
            await pb.collection('assets').unsubscribe('*');
        } catch {
            // Already unsubscribed or offline.
        }
        this.subscribed = false;
    }

    async resetCursors(userId: string): Promise<void> {
        await appKV.remove(`${SYNC_KEY_PREFIX}${userId}`);
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId } = getActiveSession();

        this.abortController = new AbortController();

        await this.pullAssets(userId);
        if (this.abortController.signal.aborted) return;

        await this.processUploadQueue(userId);

        this.currentAssetId = null;
        this.updateStatus({ currentAssetId: undefined, pendingCount: 0, progress: undefined });
    }

    // ── Pull (Server → Local) ─────────────────────────────────────────

    private async pullAssets(userId: string): Promise<void> {
        const syncKey = `${SYNC_KEY_PREFIX}${userId}`;
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let page = 1;
        let syncError: unknown = null;
        let correctionError: unknown = null;
        const offlineWrites: AssetRecord[] = [];

        try {
            while (true) {
                if (this.abortController?.signal.aborted) break;

                const result = await pb.collection('assets').getList(page, PAGE_SIZE, {
                    filter: pb.filter('userId = {:userId} && updatedAt >= {:since}', {
                        userId,
                        since: lastSyncTime
                    }),
                    sort: 'updatedAt'
                });

                const remotes = await Promise.all(
                    result.items.map((record) =>
                        this.pbToLocalRecord(record as unknown as Record<string, unknown>)
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
                        offlineWrites.push(local);
                    }
                    nextCursor = Math.max(nextCursor, remoteAt);
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (error) {
            cursorSafeToAdvance = false;
            syncError = error;
            logger.error('Failed to pull assets', error);
        }

        const scannedUnsynced = await appAsset.getAssetsSince(userId, lastSyncTime - 1);
        const pendingPushes = new Map<string, AssetRecord>();
        for (const record of offlineWrites) pendingPushes.set(record.id, record);
        for (const record of scannedUnsynced) pendingPushes.set(record.id, record);

        if (pendingPushes.size > 0) {
            try {
                await this.pushBatch([...pendingPushes.values()], false);
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

    private async handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
        try {
            if (!hasActiveSession()) return;
            const { userId: activeUserId } = getActiveSession();
            if (event.record.userId !== activeUserId) return;

            const remote = await this.pbToLocalRecord(event.record);
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
            logger.error('Realtime event error', error);
        }
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

        const { userId: activeUserId } = getActiveSession();
        if (record.userId !== activeUserId) return;

        const payload = await this.localToPbRecord(record);
        const batch = pb.createBatch();

        if (isNew) {
            batch.collection('assets').create(payload);
        } else {
            batch.collection('assets').upsert(payload);
        }

        try {
            await batch.send({ requestKey: null });
        } catch (error) {
            logger.error(`Failed to push ${record.id}`, error);
            if (throwOnError) throw error;
        }
    }

    private async pushBatch(records: AssetRecord[], swallowErrors = true): Promise<void> {
        const { userId: activeUserId } = getActiveSession();
        const owned = records.filter((r) => r.userId === activeUserId);
        if (owned.length === 0) return;

        const CHUNK_SIZE = 100;
        for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
            const chunk = owned.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                batch.collection('assets').upsert(await this.localToPbRecord(record));
            }
            try {
                await batch.send({ requestKey: null });
            } catch (error) {
                logger.error('Failed to push batch', error);
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

        const changed = await appAsset.getAssetsSince(userId, sinceInclusive - 1);
        if (changed.length === 0) return;

        void this.pushBatch(changed);
    }

    // ── Upload Queue ─────────────────────────────────────────────────

    private async processUploadQueue(userId: string): Promise<void> {
        const pending = await appAsset.getRegistryByStatus(userId, 'local');
        this.updateStatus({ pendingCount: pending.length, progress: undefined });
        if (pending.length === 0) return;

        for (const [index, entry] of pending.entries()) {
            if (this.abortController?.signal.aborted) break;

            this.currentAssetId = entry.id;
            this.updateStatus({
                currentAssetId: entry.id,
                progress: {
                    completed: index,
                    total: pending.length,
                    currentItemId: entry.id
                }
            });

            try {
                await this.uploadOne(entry);
                this.updateStatus({
                    pendingCount: Math.max(pending.length - (index + 1), 0),
                    progress: {
                        completed: index + 1,
                        total: pending.length,
                        currentItemId: entry.id
                    }
                });
            } catch (error) {
                if (this.isQuotaError(error)) throw error;
                if (this.isAuthError(error)) throw error;
                logger.error(`Failed to sync asset ${entry.id}:`, error);
            }
        }
    }

    private async uploadOne(entry: AssetRegistryRecord): Promise<void> {
        const asset = await appAsset.getAsset(entry.id);
        if (!asset || asset.isDeleted) {
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
        await this.pushRecord(updated, false, true);
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

    // ── Serialization ────────────────────────────────────────────────

    private async localToPbRecord(record: AssetRecord): Promise<Record<string, unknown>> {
        const { masterKey } = getActiveSession();
        const fields = parseFields(record);
        const payload: EncryptedAssetPayload = {
            kind: fields.kind,
            encKey: fields.encKey
        };
        const { ciphertext, iv } = await encrypt(masterKey, JSON.stringify(payload));

        return {
            id: record.id,
            userId: record.userId,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            isDeleted: record.isDeleted,
            hash: fields.hash,
            status: fields.status,
            encryptedData: toBase64(ciphertext),
            encryptedDataIV: toBase64(iv)
        };
    }

    private async pbToLocalRecord(pbRecord: Record<string, unknown>): Promise<AssetRecord> {
        const { masterKey } = getActiveSession();
        const encData = fromBase64(pbRecord.encryptedData as string);
        const encIV = fromBase64(pbRecord.encryptedDataIV as string);
        const json = await decrypt(masterKey, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as EncryptedAssetPayload;

        const fields: AssetFields = {
            kind: payload.kind,
            encKey: payload.encKey,
            hash: pbRecord.hash as string,
            status: pbRecord.status as AssetStatus
        };

        return {
            id: pbRecord.id as string,
            userId: pbRecord.userId as string,
            createdAt: this.normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
            updatedAt: this.normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
            isDeleted: Boolean(pbRecord.isDeleted),
            data: fields as unknown as Record<string, unknown>
        };
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
