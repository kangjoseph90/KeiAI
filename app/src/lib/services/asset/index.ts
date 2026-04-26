/**
 * Asset Service — KeiAI v2
 *
 * Manages asset lifecycle: read, write, delete, promote.
 *
 * Key design:
 *   assets table   — DataRecord with domain data (kind, status, hash, encKey) in plaintext
 *   assetRegistry   — local cache metadata + denormalized routing (kind, status, size, accessedAt)
 *
 * Orchestration helpers keep both in sync:
 *
 *   setRegistry    — create registry entry (size + accessedAt)
 *   touchRegistry  — update accessedAt (no-op if missing)
 *   updateAsset    — update asset table
 *   softDelete     — soft-delete asset table + storage + registry (delete queue)
 */

import { clock } from '$lib/utils/clock';
import { sha256, type Bytes } from '$lib/crypto';
import { getActiveSession } from '../session';
import {
    appAsset,
    type AssetRegistryRecord,
    type AssetKindPlain,
    type AssetStatus
} from '$lib/adapters/asset';
import type { AssetFields, AssetRecord } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { generateId } from '$lib/utils/id';
import { AppError } from '$lib/types/errors';
import {
    preprocessImage,
    deriveAssetKey,
    decryptAsset,
    isValidImageHeader,
    getRemoteURL,
    parseFields
} from './util';
import { AssetSyncService } from '../sync/asset';
import { fetchAssetFromCDN } from './remote';
import type { AssetKind } from './types';
import { CACHE_HIGH_WATERMARK, CACHE_LOW_WATERMARK } from './types';

// ─── Orchestration Helpers ───────────────────────────────────────────

/**
 * Set a registry entry with device-local cache metadata + routing fields.
 * Creates or overwrites the registry entry.
 */
async function setRegistry(
    id: string,
    size: number,
    kind: AssetKindPlain,
    status: AssetStatus
): Promise<AssetRegistryRecord> {
    const { userId } = getActiveSession();

    const now = clock.now();
    const record: AssetRegistryRecord = {
        id,
        userId,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        kind,
        status,
        size,
        accessedAt: now
    };

    // Preserve createdAt if already exists
    const existing = await appAsset.getRegistry(id);
    if (existing) {
        record.createdAt = existing.createdAt;
    }

    await appAsset.putRegistry(record);
    return record;
}

/**
 * Touch a registry entry (update accessedAt). No-op if not in registry.
 * @returns The updated record or null if not found
 */
async function touchRegistry(id: string): Promise<AssetRegistryRecord | null> {
    const existing = await appAsset.getRegistry(id);
    if (!existing || existing.isDeleted) return null;
    const now = clock.now();

    const updated: AssetRegistryRecord = {
        ...existing,
        accessedAt: now,
        updatedAt: now
    };
    await appAsset.putRegistry(updated);
    return updated;
}

/**
 * Update asset table fields.
 * Writes plaintext fields to the asset table only (registry is cache metadata).
 */
async function updateAsset(id: string, changes: Partial<AssetFields>): Promise<AssetFields> {
    const asset = await appAsset.getAsset(id);
    if (!asset) throw new AppError('NOT_FOUND', `Asset ${id} not found`);

    const fields = parseFields(asset);
    const updated: AssetFields = { ...fields, ...changes };
    const now = clock.now();

    await appAsset.putAsset({
        ...asset,
        data: updated as unknown as Record<string, unknown>,
        updatedAt: now
    });

    return updated;
}

/**
 * Soft-delete an asset: mark asset table + storage delete + registry delete queue.
 */
async function softDelete(id: string): Promise<void> {
    const { userId } = getActiveSession();

    const asset = await appAsset.getAsset(id);
    if (!asset) return;

    const fields = parseFields(asset);

    // 1 & 2. Soft-delete asset table + storage blob in parallel
    await Promise.all([
        appAsset.softDeleteAsset(id),
        appStorage.delete(`assets/${id}`).catch(() => undefined)
    ]);

    // 3. Ensure registry entry exists with isDeleted=true (delete queue)
    const now = clock.now();
    const reg = await appAsset.getRegistry(id);
    if (reg) {
        await appAsset.softDeleteRegistry(id);
    } else {
        await appAsset.putRegistry({
            id,
            userId,
            createdAt: now,
            updatedAt: now,
            isDeleted: true,
            kind: fields.kind,
            status: fields.status,
            size: 0,
            accessedAt: now
        });
    }
}

// ─── Service ─────────────────────────────────────────────────────────

export class AssetService {
    private static pendingReads = new Map<string, Promise<string | null>>();

    /**
     * Read an asset with request coalescing.
     */
    static read(id: string): Promise<string | null> {
        const pending = AssetService.pendingReads.get(id);
        if (pending) return pending;

        const promise = AssetService.readImpl(id).finally(() => {
            AssetService.pendingReads.delete(id);
        });
        AssetService.pendingReads.set(id, promise);
        return promise;
    }

    private static async readImpl(id: string): Promise<string | null> {
        // 1. Try local storage first
        const exists = await appStorage.exists(`assets/${id}`);
        if (exists) {
            const reg = await touchRegistry(id);
            if (!reg) {
                const asset = await appAsset.getAsset(id);
                const f = asset
                    ? parseFields(asset)
                    : { kind: 'private' as const, status: 'local' as const };
                await setRegistry(id, await getStorageSize(id), f.kind, f.status);
            }
            return appStorage.getRenderUrl(`assets/${id}`);
        }

        // 2. Try to fetch from CDN
        const asset = await appAsset.getAsset(id);
        if (!asset || asset.isDeleted) return null;

        let fields: AssetFields;
        try {
            fields = parseFields(asset);
        } catch {
            return null;
        }

        if (fields.status === 'local') {
            return null;
        }

        const url = getRemoteURL(fields.hash);
        const data = await fetchAssetFromCDN(url);
        if (!data || data.length === 0) return null;

        if (fields.kind === 'public') {
            const hash = await sha256(data as unknown as Bytes);
            if (hash !== fields.hash) return null;

            await appStorage.write(`assets/${id}`, data);
            try {
                await setRegistry(id, data.length, fields.kind, fields.status);
            } catch (err) {
                await appStorage.delete(`assets/${id}`).catch(() => undefined);
                throw err;
            }
            return appStorage.getRenderUrl(`assets/${id}`);
        }

        // Private / Inlay — optimistic decryption
        try {
            const plaintext = await decryptAsset(data, fields.encKey);
            if (!isValidImageHeader(plaintext)) return null;

            await appStorage.write(`assets/${id}`, plaintext);

            if (fields.status !== 'remote') {
                await updateAsset(id, { status: 'remote' });
                void AssetSyncService.pushById(id);
            }
            await setRegistry(id, plaintext.length, fields.kind, 'remote');
            return appStorage.getRenderUrl(`assets/${id}`);
        } catch {
            const hash = await sha256(data as unknown as Bytes);
            if (hash !== fields.hash) return null;

            // Self-heal: promoted to public
            await appStorage.write(`assets/${id}`, data);
            try {
                await updateAsset(id, { kind: 'public', status: 'remote' });
                void AssetSyncService.pushById(id);
                await setRegistry(id, data.length, 'public', 'remote');
            } catch (err) {
                await appStorage.delete(`assets/${id}`).catch(() => undefined);
                throw err;
            }
            return appStorage.getRenderUrl(`assets/${id}`);
        }
    }

    static async write(
        file: File | null,
        kind: AssetKind,
        hash?: string,
        encKey?: string
    ): Promise<string> {
        const { userId } = getActiveSession();

        if (!file && !hash) {
            throw new AppError('INVALID_INPUT', 'Either file or hash must be provided');
        }

        let bytes: Uint8Array | null = null;

        if (file) {
            const { blob } = await preprocessImage(file);
            bytes = new Uint8Array(await blob.arrayBuffer());

            if (blob !== file) {
                hash = undefined;
                encKey = undefined;
            }
        }

        if (bytes && !hash && !encKey) {
            [hash, encKey] = await Promise.all([
                sha256(bytes as unknown as Bytes),
                deriveAssetKey(bytes)
            ]);
        } else {
            if (!hash && bytes) hash = await sha256(bytes as unknown as Bytes);
            if (!encKey && bytes) encKey = await deriveAssetKey(bytes);
        }

        if (!hash || !encKey) {
            throw new AppError('INVALID_INPUT', 'Cannot derive hash without file data');
        }

        const id = generateId();
        const now = clock.now();
        const status = bytes ? 'local' : 'remote';
        const fields: AssetFields = { kind, status, hash, encKey };

        await appAsset.putAsset({
            id,
            userId,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            data: fields as unknown as Record<string, unknown>
        });

        if (bytes) {
            // Write file first
            await appStorage.write(`assets/${id}`, bytes);
            try {
                // Then write registry
                await appAsset.putRegistry({
                    id,
                    userId,
                    createdAt: now,
                    updatedAt: now,
                    isDeleted: false,
                    kind,
                    status: 'local',
                    size: bytes.length,
                    accessedAt: now
                });
            } catch (err) {
                // Rollback file if registry fails to prevent orphans
                await appStorage.delete(`assets/${id}`).catch(() => undefined);
                throw err;
            }

            void AssetSyncService.pushById(id);
            void AssetSyncService.start();
        }

        return id;
    }

    static async delete(id: string): Promise<void> {
        await softDelete(id);
        void AssetSyncService.pushById(id);
        void AssetSyncService.start();
    }

    static async promote(id: string): Promise<void> {
        const url = await AssetService.read(id);
        if (!url) {
            throw new AppError('NOT_FOUND', `Cannot promote: asset ${id} not readable`);
        }

        await updateAsset(id, { kind: 'public', status: 'local' });
        void AssetSyncService.pushById(id);
        void AssetSyncService.start();
    }

    static async revokeUrl(url: string): Promise<void> {
        await appStorage.revokeRenderUrl(url);
    }

    static async evictCache(): Promise<void> {
        const { userId } = getActiveSession();
        const remoteAssets = await appAsset.getRegistryByStatus(userId, 'remote');

        const totalSize = remoteAssets.reduce((sum, r) => sum + r.size, 0);
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
}

// ─── Internal Helpers ────────────────────────────────────────────────

async function getStorageSize(id: string): Promise<number> {
    try {
        return await appStorage.getSize(`assets/${id}`);
    } catch {
        return 0;
    }
}
