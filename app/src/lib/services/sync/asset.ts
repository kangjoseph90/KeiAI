/**
 * Asset Sync Engine — KeiAI v2
 *
 * Full bidirectional sync for the `assets` table + CDN upload/delete queues.
 * Encryption/decryption happens ONLY at the sync boundary.
 *
 * performSync order:
 *   1. Pull: Paged catch-up + PB Realtime subscription (table sync)
 *   2. Delete queue: Process registry entries with isDeleted=true
 *   3. Upload queue: Process registry entries with status='local'
 *
 * This module has NO dependency on Svelte stores.
 */

import { clock } from '$lib/utils/clock';
import { pb } from '$lib/adapters/pb';
import { encrypt, decrypt, toBase64, fromBase64 } from '$lib/crypto';
import { getActiveSession, hasActiveSession } from '../session';
import { appAsset, type AssetRecord, type AssetFields } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { AppError, isErrorCode } from '$lib/types/errors';
import { encryptAsset, parseFields } from '../asset/util';
import { BaseSyncEngine, type SyncStatus } from './base';
import { uploadAsset, deleteRemoteAsset, promoteAsset } from '../asset/remote';
import { createLogger } from '$lib/adapters/logger';
import { Semaphore } from '$lib/utils/semaphore';

// ─── Types ────────────────────────────────────────────────────────────

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

const logger = createLogger('sync:asset');

export interface AssetSyncStatus extends SyncStatus {
    pendingCount: number;
    currentAssetId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const PAGE_SIZE = 200;
const DELETE_CONCURRENCY = 5;
const SYNC_KEY_PREFIX = 'lastSync_assets_';

// ─── Asset Sync Engine ────────────────────────────────────────────────

export class AssetSyncEngine extends BaseSyncEngine<AssetSyncStatus> {
    private subscribed = false;
    private currentAssetId: string | null = null;
    private abortController: AbortController | null = null;

    constructor() {
        super({ pendingCount: 0 });
    }

    // ── State ─────────────────────────────────────────────────────────

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

    // ── Lifecycle ─────────────────────────────────────────────────────

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

    // ── Realtime Subscriptions ────────────────────────────────────────

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        // Ensure clean state before subscribing to avoid duplicate handlers
        await this.unsubscribeRealtime();

        await pb.collection('assets').subscribe('*', (e) => {
            void this.handleRealtimeEvent(e as unknown as RealtimeEvent);
        });
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
        try {
            await pb.collection('assets').unsubscribe('*');
        } catch {
            /* ignore */
        }
        this.subscribed = false;
    }

    // ── Cursor Management ─────────────────────────────────────────────

    async resetCursors(userId: string): Promise<void> {
        await appKV.remove(`${SYNC_KEY_PREFIX}${userId}`);
    }

    // ── Core Sync Cycle ───────────────────────────────────────────────

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId } = getActiveSession();

        this.abortController = new AbortController();

        // Phase 1: Pull catch-up from PocketBase
        await this.pullAssets(userId);

        if (this.abortController.signal.aborted) return;

        // Phase 2: Process delete queue (before uploads — hash reuse safety)
        await this.processDeleteQueue(userId);

        if (this.abortController.signal.aborted) return;

        // Phase 3: Process upload queue
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

                if (result.items.length > 0) {
                    const toUpsert: AssetRecord[] = [];

                    const remotes = await Promise.all(
                        result.items.map((serverRecord) =>
                            this.pbToLocalRecord(serverRecord as unknown as Record<string, unknown>)
                        )
                    );

                    const pairedRecords = await Promise.all(
                        remotes.map(async (remote) => ({
                            remote,
                            local: await appAsset.getAsset(remote.id)
                        }))
                    );

                    for (const { remote, local } of pairedRecords) {
                        const remoteAt = remote.updatedAt ?? 0;
                        const localAt = local?.updatedAt ?? 0;

                        if (!local || remoteAt > localAt) {
                            toUpsert.push(remote);
                            // Force eviction of local cache if remote is newer
                            await appStorage.delete(`assets/${remote.id}`).catch(() => undefined);
                            await appAsset.deleteRegistry(remote.id, { origin: 'sync' });
                        } else if (localAt > remoteAt) {
                            offlineWrites.push(local);
                        }
                        nextCursor = Math.max(nextCursor, remoteAt);
                    }

                    if (toUpsert.length > 0) {
                        for (const record of toUpsert) {
                            await appAsset.putAsset(record, { origin: 'sync' });
                        }
                    }
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (err) {
            cursorSafeToAdvance = false;
            syncError = err;
            logger.error('Failed to pull assets', err);
        }

        // Push locally-newer records (offline writes).
        // Scan from one tick before the cursor so same-ms local writes on the
        // cursor boundary cannot be hidden after a failed fire-and-forget push.
        const scannedUnsynced = await appAsset.getAssetsSince(userId, lastSyncTime - 1);
        const pendingPushes = new Map<string, AssetRecord>();
        for (const record of offlineWrites) pendingPushes.set(record.id, record);
        for (const record of scannedUnsynced) pendingPushes.set(record.id, record);
        const unsynced = [...pendingPushes.values()];
        if (unsynced.length > 0) {
            try {
                // Throw on failure so cursorSafeToAdvance remains false if push fails
                await this.pushBatch(unsynced, false);
            } catch (err) {
                correctionError = err;
            }
        }

        if (cursorSafeToAdvance && !correctionError && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        if (syncError) throw syncError;
        if (correctionError) throw correctionError;
    }

    // ── Realtime Event Handler ────────────────────────────────────────

    private async handleRealtimeEvent(e: RealtimeEvent): Promise<void> {
        try {
            if (!hasActiveSession()) return;

            const remote = await this.pbToLocalRecord(e.record);
            const remoteAt = remote.updatedAt ?? 0;

            let shouldDeleteLocalFile = false;
            // Atomic LWW check and write via transaction to avoid race conditions
            await appAsset.transaction(['assets', 'assetRegistry'], 'rw', async () => {
                const local = await appAsset.getAsset(remote.id);
                const localAt = local?.updatedAt ?? 0;

                if (!local || remoteAt > localAt) {
                    if (remote.isDeleted) {
                        await appAsset.putAsset(remote, { origin: 'sync' });
                        await appAsset.deleteRegistry(remote.id, { origin: 'sync' });
                        shouldDeleteLocalFile = true;
                    } else {
                        await appAsset.putAsset(remote, { origin: 'sync' });
                    }
                } else if (localAt > remoteAt) {
                    // Local is newer: push back to server (background fire-and-forget)
                    void this.pushRecord(local);
                }
            });
            if (shouldDeleteLocalFile) {
                await appStorage.delete(`assets/${remote.id}`).catch(() => undefined);
            }
        } catch (err) {
            logger.error('Realtime event error', err);
        }
    }

    // ── Push (Local → Server) ─────────────────────────────────────────

    async pushRecord(record: AssetRecord, isNew = false, throwOnError = false): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) {
            if (throwOnError) {
                throw new AppError('NOT_AUTHENTICATED', 'Cannot push asset without sync session');
            }
            return;
        }

        const payload = await this.localToPbRecord(record);
        const batch = pb.createBatch();

        if (isNew) {
            batch.collection('assets').create(payload);
        } else {
            batch.collection('assets').upsert(payload);
        }

        try {
            await batch.send({ requestKey: null });
        } catch (err) {
            logger.error(`Failed to push ${record.id}`, err);
            if (throwOnError) throw err;
        }
    }

    private async pushBatch(records: AssetRecord[], swallowErrors = true): Promise<void> {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                batch.collection('assets').upsert(await this.localToPbRecord(record));
            }
            try {
                await batch.send({ requestKey: null });
            } catch (err) {
                logger.error('Failed to push batch', err);
                if (!swallowErrors) {
                    throw err;
                }
            }
        }
    }

    async pushById(id: string): Promise<void> {
        const record = await appAsset.getAsset(id);
        if (record) void this.pushRecord(record);
    }

    async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const changed = await appAsset.getAssetsSince(userId, sinceInclusive - 1);
        if (changed.length === 0) return;

        void this.pushBatch(changed);
    }

    // ── Delete Queue Processing ───────────────────────────────────────

    private async processDeleteQueue(userId: string): Promise<void> {
        const pending = await appAsset.getDeletedRegistry(userId);
        if (pending.length === 0) return;

        const semaphore = new Semaphore(DELETE_CONCURRENCY);
        const results = await Promise.allSettled(
            pending.map((entry) =>
                semaphore.runExclusive(async () => {
                    if (this.abortController?.signal.aborted) return;

                    if (entry.status === 'remote') {
                        const asset = await appAsset.getAsset(entry.id);
                        if (asset) {
                            const fields = parseFields(asset);
                            await deleteRemoteAsset(fields.hash);
                        }
                    }
                    await appAsset.deleteRegistry(entry.id);
                })
            )
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                if (this.isAuthError(result.reason)) throw result.reason;
                logger.error('Failed to process delete:', result.reason);
            }
        }
    }

    // ── Upload Queue Processing ───────────────────────────────────────

    private async processUploadQueue(userId: string): Promise<void> {
        const pending = await appAsset.getRegistryByStatus(userId, 'local');
        this.updateStatus({ pendingCount: pending.length, progress: undefined });

        if (pending.length === 0) return;

        // Batch read only the pending assets concurrently
        const pendingAssets = await Promise.all(
            pending.map((entry) => appAsset.getAsset(entry.id))
        );
        const assetMap = new Map();
        for (const asset of pendingAssets) {
            if (asset && !asset.isDeleted) {
                assetMap.set(asset.id, asset);
            }
        }

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
                const blob = await appStorage.read(`assets/${entry.id}`);
                if (!blob) continue;

                // Read hash/encKey from assets table (only needed for actual I/O)
                const asset = assetMap.get(entry.id);
                if (!asset || asset.isDeleted) continue;
                const fields = parseFields(asset);

                if (entry.kind === 'public') {
                    await promoteAsset(fields.hash, blob);
                } else {
                    const encrypted = await encryptAsset(blob, fields.encKey);
                    await uploadAsset(fields.hash, entry.kind, encrypted.length, encrypted);
                }

                const updatedFields: AssetFields = {
                    kind: entry.kind,
                    status: 'remote',
                    hash: fields.hash,
                    encKey: fields.encKey
                };

                const updatedRecord: AssetRecord = {
                    id: entry.id,
                    userId: entry.userId,
                    createdAt: entry.createdAt,
                    updatedAt: clock.now(),
                    isDeleted: false,
                    data: updatedFields as unknown as Record<string, unknown>
                };
                // 1. Commit metadata to local DB first
                await appAsset.putAsset(updatedRecord);

                // 2. Push metadata to server (Crucial: only advance registry if this succeeds)
                await this.pushRecord(updatedRecord, false, true);

                // 3. Finally mark registry as remote
                await appAsset.putRegistry({
                    id: entry.id,
                    userId: entry.userId,
                    createdAt: entry.createdAt,
                    updatedAt: clock.now(),
                    isDeleted: false,
                    kind: entry.kind,
                    status: 'remote',
                    size: entry.size,
                    accessedAt: entry.accessedAt
                });

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

    // ── Serialization Helpers ─────────────────────────────────────────

    private async localToPbRecord(record: AssetRecord): Promise<Record<string, unknown>> {
        const { masterKey } = getActiveSession();
        const { id, userId, createdAt, updatedAt, isDeleted, ...rest } = record;
        const { ciphertext, iv } = await encrypt(masterKey, JSON.stringify(rest));

        return {
            id,
            userId,
            createdAt,
            updatedAt,
            isDeleted,
            encryptedData: toBase64(ciphertext),
            encryptedDataIV: toBase64(iv)
        };
    }

    private async pbToLocalRecord(pbRecord: Record<string, unknown>): Promise<AssetRecord> {
        const { masterKey } = getActiveSession();
        const encData = fromBase64(pbRecord.encryptedData as string);
        const encIV = fromBase64(pbRecord.encryptedDataIV as string);
        const json = await decrypt(masterKey, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as Record<string, unknown>;

        return {
            ...payload,
            id: pbRecord.id as string,
            userId: pbRecord.userId as string,
            createdAt: this.normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
            updatedAt: this.normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
            isDeleted: Boolean(pbRecord.isDeleted)
        } as AssetRecord;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;
        if (error instanceof Response) {
            return error.status === 402 || error.status === 413;
        }
        const err = error as { status?: number };
        return err?.status === 402 || err?.status === 413;
    }

    protected override isAuthError(error: unknown): boolean {
        if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED'))
            return true;
        if (error instanceof Response) {
            return error.status === 401 || error.status === 403;
        }
        const err = error as { status?: number };
        return err?.status === 401 || err?.status === 403;
    }
}

// ─── Export Singleton ─────────────────────────────────────────────────

export const AssetSyncService = new AssetSyncEngine();
