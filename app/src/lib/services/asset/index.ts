/**
 * Asset Service — KeiAI v2
 *
 * Manages asset lifecycle: read, write, delete, promote.
 *
 * Key design: AssetRegistryRecord is a device-local plaintext cache of the
 * encrypted AssetFields. Orchestration helpers keep both in sync:
 *
 *   setRegistry    — create registry entry (accepts pre-decrypted fields)
 *   touchRegistry  — update accessedAt (no-op if missing)
 *   updateAsset    — update asset table + propagate to registry if present
 *   softDelete     — soft-delete asset table + storage + registry (delete queue)
 */

import { sha256, type Bytes } from '$lib/crypto';
import { getActiveSession } from '../session';
import { appAsset, type AssetRegistryRecord } from '$lib/adapters/asset';
import type { AssetFields, AssetRecord } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { generateId } from '$lib/utils/id';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';
import {
    preprocessImage,
    deriveAssetKey,
    decryptAsset,
    isValidImageHeader,
    getRemoteURL,
    encryptFields,
    decryptFields
} from './util';
import { fetchAssetFromCDN } from './remote';
import type { AssetKind } from './types';
import { CACHE_HIGH_WATERMARK, CACHE_LOW_WATERMARK } from './types';

// ─── Orchestration Helpers ───────────────────────────────────────────

/**
 * Set a registry entry from decrypted or provided fields.
 * Creates or overwrites the registry entry.
 *
 * @param id - Asset ID
 * @param size - Blob size in bytes (0 for entries without a local blob)
 * @param fields - Pre-decrypted AssetFields (skips redundant DB read + decrypt)
 * @returns The created/updated registry record
 */
async function setRegistry(
    id: string,
    size: number,
    fields?: AssetFields
): Promise<AssetRegistryRecord> {
    const { masterKey, userId } = getActiveSession();

    // Use provided fields or fall back to decrypting from asset table
    let assetFields = fields;
    if (!assetFields) {
        const asset = await appAsset.getAsset(id);
        if (!asset) throw new AppError('NOT_FOUND', `Asset ${id} not found in asset table`);
        assetFields = await decryptFields(masterKey, asset);
    }

    const now = Date.now();
    const record: AssetRegistryRecord = {
        id,
        userId,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        kind: assetFields.kind,
        status: assetFields.status,
        hash: assetFields.hash,
        encKey: assetFields.encKey,
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

    const updated: AssetRegistryRecord = {
        ...existing,
        accessedAt: Date.now(),
        updatedAt: Date.now()
    };
    await appAsset.putRegistry(updated);
    return updated;
}

/**
 * Update asset table fields and propagate to registry if present.
 * Encrypts the new fields and writes to the asset table, then
 * mirrors changed fields to the registry entry.
 */
async function updateAsset(id: string, changes: DeepPartial<AssetFields>): Promise<AssetFields> {
    const { masterKey, userId } = getActiveSession();
    const asset = await appAsset.getAsset(id);
    if (!asset) throw new AppError('NOT_FOUND', `Asset ${id} not found`);

    const fields = await decryptFields(masterKey, asset);
    const updated: AssetFields = { ...fields, ...changes };

    const { ciphertext, iv } = await encryptFields(masterKey, updated);
    await appAsset.putAsset({
        ...asset,
        encryptedData: ciphertext as unknown as Bytes,
        encryptedDataIV: iv as unknown as Bytes,
        updatedAt: Date.now()
    });

    // Propagate to registry if present
    const reg = await appAsset.getRegistry(id);
    if (reg) {
        await appAsset.putRegistry({
            ...reg,
            ...changes,
            updatedAt: Date.now()
        });
    }

    return updated;
}

/**
 * Soft-delete an asset: mark asset table + storage delete + registry delete queue.
 * The registry entry with isDeleted=true serves as a persistent delete queue
 * for the sync engine to process CDN cleanup.
 */
async function softDelete(id: string): Promise<void> {
    const { masterKey, userId } = getActiveSession();

    // Read asset fields before soft-deleting (needed for delete queue)
    const asset = await appAsset.getAsset(id);
    if (!asset) return;

    let fields: AssetFields;
    try {
        fields = await decryptFields(masterKey, asset);
    } catch {
        // Can't decrypt — still soft-delete the metadata
        await Promise.all([
            appAsset.softDeleteAsset(id),
            appStorage.delete(`assets/${id}`).catch(() => undefined)
        ]);
        return;
    }

    // 1 & 2. Soft-delete asset table + storage blob in parallel
    await Promise.all([
        appAsset.softDeleteAsset(id),
        appStorage.delete(`assets/${id}`).catch(() => undefined)
    ]);

    // 3. Ensure registry entry exists with isDeleted=true (delete queue)
    const now = Date.now();
    const reg = await appAsset.getRegistry(id);
    if (reg) {
        // Mark existing entry as deleted (preserves status/hash for sync engine)
        await appAsset.softDeleteRegistry(id);
    } else {
        // Create a delete queue entry from decrypted fields
        await appAsset.putRegistry({
            id,
            userId,
            createdAt: now,
            updatedAt: now,
            isDeleted: true,
            kind: fields.kind,
            status: fields.status,
            hash: fields.hash,
            encKey: fields.encKey,
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
     * Concurrent reads of the same ID share a single CDN fetch + decrypt.
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

    /**
     * Internal read implementation.
     *
     * Resolution order:
     *   1. Local storage hit → touch registry → return URL
     *   2. CDN download → metadata-driven verification → cache locally → return URL
     *
     * Verification strategy (priority-based):
     *   - Public: hash verification of plaintext
     *   - Private/Inlay: optimistic AES-GCM decrypt → fallback hash check (promotion heal)
     */
    private static async readImpl(id: string): Promise<string | null> {
        const { masterKey } = getActiveSession();

        // 1. Try local storage first
        const exists = await appStorage.exists(`assets/${id}`);
        if (exists) {
            // Heal: ensure registry entry exists
            const reg = await touchRegistry(id);
            if (!reg) {
                // Registry missing but file exists — heal by creating entry
                await setRegistry(id, await getStorageSize(id));
            }
            return appStorage.getRenderUrl(`assets/${id}`);
        }

        // At this point, no local file. Registry should not exist either (invariant).

        // 2. Try to fetch from CDN
        const asset = await appAsset.getAsset(id);
        if (!asset || asset.isDeleted) return null;

        let fields: AssetFields;
        try {
            fields = await decryptFields(masterKey, asset);
        } catch {
            return null;
        }

        if (fields.status === 'local') {
            // CDN doesn't have the correct version yet
            return null;
        }

        const url = getRemoteURL(fields.hash);
        const data = await fetchAssetFromCDN(url);
        if (!data || data.length === 0) return null;

        // Priority-based verification: trust metadata, verify with data

        if (fields.kind === 'public') {
            // Public asset — verify integrity via content hash
            const hash = await sha256(data as unknown as Bytes);
            if (hash !== fields.hash) return null;

            await Promise.all([
                appStorage.write(`assets/${id}`, data),
                setRegistry(id, data.length, fields)
            ]);
            return appStorage.getRenderUrl(`assets/${id}`);
        }

        // Private / Inlay — optimistic decryption
        try {
            const plaintext = await decryptAsset(data, fields.encKey);
            if (!isValidImageHeader(plaintext)) return null;

            await appStorage.write(`assets/${id}`, plaintext);

            if (fields.status !== 'remote') {
                await updateAsset(id, { status: 'remote' });
            }
            await setRegistry(id, plaintext.length, fields);
            return appStorage.getRenderUrl(`assets/${id}`);
        } catch {
            // Decrypt failed — asset may have been promoted to public
            const hash = await sha256(data as unknown as Bytes);
            if (hash !== fields.hash) return null;

            // Self-heal: promoted to public
            await appStorage.write(`assets/${id}`, data);
            await updateAsset(id, { kind: 'public', status: 'remote' });
            await setRegistry(id, data.length, { ...fields, kind: 'public', status: 'remote' });
            return appStorage.getRenderUrl(`assets/${id}`);
        }
    }

    /**
     * Write a new asset.
     *
     * @param file - The image file (optional if hash+encKey provided for imports)
     * @param kind - Asset kind: private, inlay, or public
     * @param hash - Pre-computed hash (for imports with known assets)
     * @param encKey - Pre-computed encryption key (for imports)
     * @returns The new asset ID
     */
    static async write(
        file: File | null,
        kind: AssetKind,
        hash?: string,
        encKey?: string
    ): Promise<string> {
        const { masterKey, userId } = getActiveSession();

        if (!file && !hash) {
            throw new AppError('INVALID_INPUT', 'Either file or hash must be provided');
        }

        let bytes: Uint8Array | null = null;

        if (file) {
            // Preprocess: resize + compress to WebP if needed
            const { blob } = await preprocessImage(file);
            bytes = new Uint8Array(await blob.arrayBuffer());

            // If file was preprocessed, invalidate pre-computed hashes
            if (blob !== file) {
                hash = undefined;
                encKey = undefined;
            }
        }

        // Derive hash and encKey in parallel if both needed
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
        const now = Date.now();

        // Determine initial status: file present → local, import → remote
        const status = bytes ? 'local' : 'remote';

        const fields: AssetFields = { kind, status, hash, encKey };
        const { ciphertext, iv } = await encryptFields(masterKey, fields);

        if (bytes) {
            // OPFS first (most likely to fail, avoids orphan metadata)
            await appStorage.write(`assets/${id}`, bytes);

            // Parallel IDB writes
            const assetRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: Date.now(),
                isDeleted: false,
                encryptedData: ciphertext as unknown as Bytes,
                encryptedDataIV: iv as unknown as Bytes
            };
            await Promise.all([
                appAsset.putAsset(assetRecord),
                appAsset.putRegistry({
                    id,
                    userId,
                    createdAt: now,
                    updatedAt: now,
                    isDeleted: false,
                    kind,
                    status: 'local',
                    hash,
                    encKey,
                    size: bytes.length,
                    accessedAt: now
                })
            ]);
        } else {
            await appAsset.putAsset({
                id,
                userId,
                createdAt: now,
                updatedAt: Date.now(),
                isDeleted: false,
                encryptedData: ciphertext as unknown as Bytes,
                encryptedDataIV: iv as unknown as Bytes
            });
        }

        return id;
    }

    /**
     * Delete an asset.
     * Soft-deletes the asset table, removes storage blob,
     * and marks registry as delete queue entry for sync engine.
     */
    static async delete(id: string): Promise<void> {
        await softDelete(id);
    }

    /**
     * Promote a private/inlay asset to public.
     * Ensures the local blob is available, then marks kind=public, status=local.
     * The sync engine will upload the plaintext to the server.
     */
    static async promote(id: string): Promise<void> {
        // Ensure local blob is available (downloads from CDN if needed)
        const url = await AssetService.read(id);
        if (!url) {
            throw new AppError('NOT_FOUND', `Cannot promote: asset ${id} not readable`);
        }

        // Update kind to public, status to local (needs re-upload as plaintext)
        await updateAsset(id, { kind: 'public', status: 'local' });
    }

    /**
     * Revoke a render URL previously created by read().
     */
    static async revokeUrl(url: string): Promise<void> {
        await appStorage.revokeRenderUrl(url);
    }

    /**
     * Evict cached assets to free storage space.
     * Removes blobs in LRU order until below the low watermark.
     */
    static async evictCache(): Promise<void> {
        const { userId } = getActiveSession();
        const registry = await appAsset.getAllRegistry(userId);

        // Only evict remote assets (local ones haven't been uploaded yet)
        const remoteAssets = registry.filter((r) => r.status === 'remote');

        const totalSize = remoteAssets.reduce((sum, r) => sum + r.size, 0);
        if (totalSize <= CACHE_HIGH_WATERMARK) return;

        // Sort by accessedAt ascending (least recently used first)
        const sorted = remoteAssets.sort((a, b) => a.accessedAt - b.accessedAt);

        // Calculate eviction list upfront
        const toEvict: AssetRegistryRecord[] = [];
        let remaining = totalSize;
        for (const entry of sorted) {
            if (remaining <= CACHE_LOW_WATERMARK) break;
            toEvict.push(entry);
            remaining -= entry.size;
        }

        // Batch delete (OPFS + IDB in parallel per entry)
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
