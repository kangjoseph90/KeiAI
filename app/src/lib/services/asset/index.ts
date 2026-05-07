/**
 * Asset Service — KeiAI v3
 *
 * assets       — logical asset SOT and sync metadata
 * assetRegistry — device-local cache index, with denormalized kind/status for fast queries
 * appStorage   — plaintext image bytes cache
 */

import {
    appAsset,
    type AssetFields,
    type AssetRecord,
    type AssetRegistryRecord,
    type AssetStatus
} from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { clock } from '$lib/utils/clock';
import { generateId } from '$lib/utils/id';
import { AppError } from '$lib/types/errors';
import { getActiveSession } from '../user';
import { AssetSyncService } from '../sync/asset';
import type { AssetKind } from './types';
import { CACHE_HIGH_WATERMARK, CACHE_LOW_WATERMARK } from './types';
import {
    decryptConvergentAsset,
    encryptConvergentAsset,
    isValidImageHeader,
    parseFields,
    preprocessImage
} from './util';
import { fetchAssetCiphertext } from './remote';
import { sha256, type Bytes } from '$lib/crypto';

// ─── Registry Helpers ────────────────────────────────────────────────

async function setRegistry(
    id: string,
    size: number,
    kind: AssetKind,
    status: AssetStatus
): Promise<AssetRegistryRecord> {
    const { userId } = getActiveSession();
    const now = clock.now();
    const existing = await appAsset.getRegistry(id);

    const record: AssetRegistryRecord = {
        id,
        userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        isDeleted: false,
        kind,
        status,
        size,
        accessedAt: now
    };

    await appAsset.putRegistry(record);
    return record;
}

async function touchRegistry(id: string): Promise<void> {
    const { userId } = getActiveSession();
    const existing = await appAsset.getRegistry(id);
    if (!existing || existing.isDeleted || existing.userId !== userId) return;

    await appAsset.putRegistry({
        ...existing,
        accessedAt: clock.now(),
        updatedAt: clock.now()
    });
}

async function getStorageSize(id: string): Promise<number> {
    try {
        return await appStorage.getSize(`assets/${id}`);
    } catch {
        return 0;
    }
}

async function syncRegistryIndex(id: string, kind: AssetKind, status: AssetStatus): Promise<void> {
    const { userId } = getActiveSession();
    const existing = await appAsset.getRegistry(id);
    if (!existing || existing.isDeleted || existing.userId !== userId) return;
    if (existing.kind === kind && existing.status === status) return;

    await appAsset.putRegistry({
        ...existing,
        kind,
        status,
        updatedAt: clock.now()
    });
}

// ─── Asset Table Helpers ─────────────────────────────────────────────
async function updateAssetFields(id: string, changes: Partial<AssetFields>): Promise<AssetRecord> {
    const { userId } = getActiveSession();
    const asset = await appAsset.getAsset(id);
    if (!asset || asset.isDeleted || asset.userId !== userId) {
        throw new AppError('NOT_FOUND', `Asset ${id} not found`);
    }

    const fields = { ...parseFields(asset), ...changes };
    const updated: AssetRecord = {
        ...asset,
        data: fields as unknown as Record<string, unknown>,
        updatedAt: clock.now()
    };
    await appAsset.putAsset(updated);
    await syncRegistryIndex(id, fields.kind, fields.status);
    return updated;
}

// ─── Service ─────────────────────────────────────────────────────────

export class AssetService {
    private static isEvictionPaused = false;
    private static pendingLoads = new Map<string, Promise<boolean>>();

    /**
     * Loads an asset into local appStorage without returning a render URL.
     * Useful for prefetching or migration prepare steps.
     * @returns true if the asset is now available locally, false if it failed.
     */
    static load(id: string): Promise<boolean> {
        const { userId } = getActiveSession();
        const pendingKey = `${userId}:${id}`;
        const pending = AssetService.pendingLoads.get(pendingKey);
        if (pending) return pending;

        const promise = AssetService.loadImpl(id).finally(() => {
            AssetService.pendingLoads.delete(pendingKey);
        });
        AssetService.pendingLoads.set(pendingKey, promise);
        return promise;
    }

    /**
     * Loads an asset and returns its renderable URL.
     */
    static async read(id: string): Promise<string | null> {
        const success = await AssetService.load(id);
        if (!success) return null;
        return appStorage.getRenderUrl(`assets/${id}`);
    }

    private static async loadImpl(id: string): Promise<boolean> {
        const { userId } = getActiveSession();
        const asset = await appAsset.getAsset(id);
        if (!asset || asset.isDeleted || asset.userId !== userId) return false;

        const fields = parseFields(asset);
        const storagePath = `assets/${id}`;

        if (await appStorage.exists(storagePath)) {
            await setRegistry(id, await getStorageSize(id), fields.kind, fields.status);
            await touchRegistry(id);
            return true;
        }

        if (fields.status === 'local') {
            return false;
        }

        const ciphertext = await fetchAssetCiphertext(fields.hash);
        if (!ciphertext || ciphertext.length === 0) return false;

        const actualHash = await sha256(ciphertext as unknown as Bytes);
        if (actualHash !== fields.hash) return false;

        const plaintext = await decryptConvergentAsset(ciphertext, fields.encKey);
        if (!isValidImageHeader(plaintext)) return false;

        await appStorage.write(storagePath, plaintext);
        try {
            await setRegistry(id, plaintext.length, fields.kind, fields.status);
        } catch (error) {
            await appStorage.delete(storagePath).catch(() => undefined);
            throw error;
        }

        return true;
    }

    static async write(
        file: File | null,
        kind: AssetKind,
        hash?: string,
        encKey?: string
    ): Promise<string> {
        const { userId } = getActiveSession();

        if (!file && (!hash || !encKey)) {
            throw new AppError('INVALID_INPUT', 'Either file or hash+encKey must be provided');
        }

        const id = generateId();
        const now = clock.now();
        let fields: AssetFields;
        let plaintext: Uint8Array | null = null;

        if (file) {
            const { blob } = await preprocessImage(file);
            plaintext = new Uint8Array(await blob.arrayBuffer());
            const encrypted = await encryptConvergentAsset(plaintext);
            fields = {
                kind,
                status: 'local',
                hash: encrypted.hash,
                encKey: encrypted.encKey
            };
        } else {
            fields = {
                kind,
                status: 'remote',
                hash: hash as string,
                encKey: encKey as string
            };
        }

        const record: AssetRecord = {
            id,
            userId,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            data: fields as unknown as Record<string, unknown>
        };

        if (!plaintext) {
            await appAsset.putAsset(record);
            void AssetSyncService.pushById(id);
            return id;
        }

        await appStorage.write(`assets/${id}`, plaintext);
        try {
            await setRegistry(id, plaintext.length, fields.kind, fields.status);
            await appAsset.putAsset(record);
        } catch (error) {
            await Promise.all([
                appStorage.delete(`assets/${id}`).catch(() => undefined),
                appAsset.deleteRegistry(id).catch(() => undefined)
            ]);
            throw error;
        }

        void AssetSyncService.pushById(id);
        void AssetSyncService.start();
        return id;
    }

    static async delete(id: string): Promise<void> {
        const { userId } = getActiveSession();
        const asset = await appAsset.getAsset(id);
        if (!asset || asset.isDeleted || asset.userId !== userId) {
            throw new AppError('NOT_FOUND', `Asset ${id} not found`);
        }

        await Promise.all([
            appAsset.softDeleteAsset(id),
            appStorage.delete(`assets/${id}`).catch(() => undefined),
            appAsset.deleteRegistry(id).catch(() => undefined)
        ]);
        void AssetSyncService.pushById(id);
        void AssetSyncService.start();
    }

    static async markRemote(id: string): Promise<AssetRecord> {
        return updateAssetFields(id, { status: 'remote' });
    }

    static async markLocal(id: string): Promise<AssetRecord> {
        return updateAssetFields(id, { status: 'local' });
    }

    static async markLocalBatch(ids: string[]): Promise<void> {
        await appAsset.transaction(['assets', 'assetRegistry'], 'rw', async () => {
            for (const id of ids) {
                const { userId } = getActiveSession();
                const asset = await appAsset.getAsset(id);
                if (!asset || asset.isDeleted || asset.userId !== userId) {
                    throw new AppError('NOT_FOUND', `Asset ${id} not found`);
                }

                const fields = { ...parseFields(asset), status: 'local' as const };
                await appAsset.putAsset({
                    ...asset,
                    data: fields as unknown as Record<string, unknown>,
                    updatedAt: clock.now()
                });

                await syncRegistryIndex(id, fields.kind, fields.status);
            }
        });
    }

    static async revokeUrl(url: string): Promise<void> {
        await appStorage.revokeRenderUrl(url);
    }

    static async evictCache(): Promise<void> {
        if (AssetService.isEvictionPaused) return;

        const { userId } = getActiveSession();
        const remoteAssets = await appAsset.getRegistryByStatus(userId, 'remote');

        const totalSize = remoteAssets.reduce((sum, record) => sum + record.size, 0);
        if (totalSize <= CACHE_HIGH_WATERMARK) return;

        const sorted = remoteAssets.sort((a, b) => a.accessedAt - b.accessedAt);
        const toEvict: AssetRegistryRecord[] = [];
        let remaining = totalSize;

        for (const entry of sorted) {
            if (remaining <= CACHE_LOW_WATERMARK) break;
            toEvict.push(entry);
            remaining -= entry.size;
        }

        await Promise.all(
            toEvict.map((entry) =>
                Promise.all([
                    appStorage.delete(`assets/${entry.id}`).catch(() => undefined),
                    appAsset.deleteRegistry(entry.id)
                ])
            )
        );
    }

    static async getAllAssets(userId: string): Promise<AssetRecord[]> {
        return await appAsset.getAllAssets(userId);
    }

    static stopEviction(): void {
        AssetService.isEvictionPaused = true;
    }

    static resumeEviction(): void {
        AssetService.isEvictionPaused = false;
        // Optionally trigger eviction immediately after resuming
        void AssetService.evictCache();
    }
}
