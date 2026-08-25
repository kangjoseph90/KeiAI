/**
 * Asset Service - KeiAI
 *
 * Parent records are the sync-visible asset manifest through `assetEntries`.
 * The local asset adapter owns the cached plaintext blob plus its owner/hash
 * registry row. There is no separate synced asset metadata row in v4.
 */

import {
    appAsset,
    assetRegistryId,
    type AssetLocator,
    type AssetOwner,
    type AssetRegistryRecord
} from '$lib/adapters/asset';
import { localDB, type DataRecord, type DataScope } from '$lib/adapters/db';
import { clock } from '$lib/utils/clock';
import { AppError } from '$lib/types/errors';
import { canAccessScope } from '../session';
import {
    CACHE_HIGH_WATERMARK,
    CACHE_LOW_WATERMARK,
    MAX_ASSET_SIZE_BY_MEDIA_TYPE,
    type AssetReadLocator
} from './types';
import { decryptConvergentAsset, encryptConvergentAsset, fileToPlaintext } from './util';
import { fetchAssetCiphertext } from './remote';
import { sha256, type Bytes } from '$lib/crypto';
import {
    getAssetMediaType,
    FILE_ASSET_MIME_TYPES,
    type AssetEntries,
    type AssetFields,
    type AssetMediaType,
    type AssetStatus
} from '$lib/types/asset';

export type { AssetLocator, AssetOwner, AssetReadLocator, AssetRegistryRecord } from './types';
export { ASSET_URI_MARKER, ASSET_URI_PATTERN, createAssetUri, parseAssetUri } from './uri';

const SUPPORTED_ASSET_TYPES: readonly AssetMediaType[] = ['image', 'audio', 'video', 'other'];

export interface AssetUrlLease {
    readonly url: string;
    release(): Promise<void>;
}

interface AssetUrlCacheEntry {
    locator: AssetReadLocator;
    refs: number;
    url?: string;
    promise?: Promise<void>;
}

async function updateOwnerEntryStatus(locator: AssetLocator, status: AssetStatus): Promise<void> {
    const record = await localDB.getRecord<DataRecord>(locator.ownerTable, locator.ownerId);
    if (!record || record.isDeleted || !canAccessScope(record)) return;

    const previous = record.assetEntries ?? {};
    if (previous[locator.hash] === status) return;

    const assetEntries: AssetEntries = {
        ...previous,
        [locator.hash]: status
    };

    await localDB.putRecord(locator.ownerTable, {
        ...record,
        assetEntries,
        updatedAt: clock.now()
    });
}

export class AssetService {
    private static isEvictionPaused = false;
    private static pendingLoads = new Map<string, Promise<boolean>>();
    private static evictionTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly EVICTION_DEBOUNCE_MS = 5_000;

    private static readonly urlCache = new Map<string, AssetUrlCacheEntry>();

    private static async evictUrlCacheForKey(key: string): Promise<void> {
        const entry = AssetService.urlCache.get(key);
        AssetService.urlCache.delete(key);
        if (entry?.url) {
            await appAsset.revokeRenderUrl(entry.url);
        }
    }

    private static async evictUrlCacheWhere(
        predicate: (locator: AssetLocator) => boolean
    ): Promise<void> {
        const keys = Array.from(AssetService.urlCache.entries())
            .filter(([, entry]) => predicate(entry.locator))
            .map(([key]) => key);
        await Promise.all(
            keys.map(async (key) => {
                await AssetService.evictUrlCacheForKey(key);
            })
        );
    }

    private static validateMimeType(
        mimeType: string,
        allowedMediaTypes: readonly AssetMediaType[] = SUPPORTED_ASSET_TYPES
    ): AssetMediaType {
        const normalizedMimeType = mimeType.trim().toLowerCase().split(';', 1)[0];
        if (
            !normalizedMimeType.startsWith('text/') &&
            !(FILE_ASSET_MIME_TYPES as readonly string[]).includes(normalizedMimeType)
        ) {
            throw new AppError(
                'ASSET_ERROR',
                `Unsupported asset format: ${mimeType || 'unknown'}.`
            );
        }

        const mediaType = getAssetMediaType(normalizedMimeType);
        if (!allowedMediaTypes.includes(mediaType)) {
            throw new AppError(
                'ASSET_ERROR',
                `Expected ${allowedMediaTypes.join(' or ')} asset, but received ${mediaType}.`
            );
        }
        return mediaType;
    }

    static async write(
        file: File,
        owner: AssetOwner,
        allowedMediaTypes: readonly AssetMediaType[] = SUPPORTED_ASSET_TYPES
    ): Promise<AssetFields> {
        const { bytes, mimeType, width, height } = await fileToPlaintext(file);
        const mediaType = AssetService.validateMimeType(mimeType, allowedMediaTypes);
        const maxSize = MAX_ASSET_SIZE_BY_MEDIA_TYPE[mediaType];
        if (bytes.byteLength > maxSize) {
            throw new AppError(
                'ASSET_ERROR',
                `${file.name} exceeds the ${maxSize / (1024 * 1024)} MB ${mediaType} asset limit.`
            );
        }

        const encrypted = await encryptConvergentAsset(bytes);
        const fields: AssetFields = {
            name: file.name,
            hash: encrypted.hash,
            encKey: encrypted.encKey,
            mimeType,
            width,
            height
        };

        try {
            await appAsset.putLocalAsset({
                ...owner,
                hash: fields.hash,
                encKey: fields.encKey,
                bytes
            });
        } catch (error) {
            throw new AppError('DB_WRITE_FAILED', 'Failed to write asset', error);
        }

        return fields;
    }

    static async load(locator: AssetReadLocator): Promise<boolean> {
        const key = assetRegistryId(locator);
        const pending = AssetService.pendingLoads.get(key);
        if (pending) return pending;

        const promise = AssetService.loadImpl(locator).finally(() => {
            AssetService.pendingLoads.delete(key);
        });
        AssetService.pendingLoads.set(key, promise);
        return promise;
    }

    static async acquireUrl(locator: AssetReadLocator): Promise<AssetUrlLease | null> {
        const key = assetRegistryId(locator);
        let entry = AssetService.urlCache.get(key);

        if (!entry) {
            entry = {
                locator,
                refs: 0
            };
            AssetService.urlCache.set(key, entry);
            entry.promise = AssetService.initializeUrlEntry(key, entry);
        }

        if (entry.promise) {
            await entry.promise;
        }
        if (AssetService.urlCache.get(key) !== entry || !entry.url) {
            return null;
        }

        return AssetService.createUrlLease(key, entry);
    }

    private static async initializeUrlEntry(key: string, entry: AssetUrlCacheEntry): Promise<void> {
        try {
            const success = await AssetService.load(entry.locator);
            const url = success
                ? await appAsset.getRenderUrl(
                      entry.locator,
                      AssetService.renderMimeType(entry.locator.mimeType)
                  )
                : null;
            if (AssetService.urlCache.get(key) !== entry) {
                if (url) await appAsset.revokeRenderUrl(url);
                return;
            }
            if (url) {
                entry.url = url;
            } else {
                AssetService.urlCache.delete(key);
            }
        } catch (error) {
            if (AssetService.urlCache.get(key) === entry) {
                AssetService.urlCache.delete(key);
            }
            throw error;
        } finally {
            entry.promise = undefined;
        }
    }

    private static renderMimeType(mimeType?: string): string {
        const declared = mimeType?.trim().toLowerCase();
        const normalized = declared?.split(';', 1)[0];
        if (!normalized) return 'application/octet-stream';
        if (
            normalized.startsWith('text/') ||
            normalized === 'application/json' ||
            normalized === 'application/xml' ||
            normalized === 'application/x-yaml' ||
            normalized === 'application/toml' ||
            normalized === 'application/sql'
        ) {
            const charset = declared.match(/(?:^|;)\s*charset\s*=\s*([\w.-]+)/)?.[1] ?? 'utf-8';
            return `text/plain;charset=${charset}`;
        }
        return declared;
    }

    private static createUrlLease(key: string, entry: AssetUrlCacheEntry): AssetUrlLease {
        const url = entry.url;
        if (!url) {
            throw new AppError('ASSET_ERROR', 'Cannot lease an unavailable asset URL.');
        }

        entry.refs++;
        let released = false;

        return {
            url,
            release: async () => {
                if (released) return;
                released = true;
                entry.refs--;
                if (entry.refs > 0) return;
                if (AssetService.urlCache.get(key) !== entry) return;

                AssetService.urlCache.delete(key);
                await appAsset.revokeRenderUrl(url);
            }
        };
    }

    private static async loadImpl(locator: AssetReadLocator): Promise<boolean> {
        if (await appAsset.hasAsset(locator)) {
            await appAsset.touchAsset(locator);
            return true;
        }

        const ciphertext = await fetchAssetCiphertext(locator.hash);
        if (!ciphertext || ciphertext.length === 0) return false;

        const actualHash = await sha256(ciphertext as unknown as Bytes);
        if (actualHash !== locator.hash) return false;

        const plaintext = await decryptConvergentAsset(ciphertext, locator.encKey);
        await appAsset.putRemoteAsset({
            ...locator,
            bytes: plaintext
        });
        AssetService.scheduleEviction();
        return true;
    }

    static async readBytes(locator: AssetLocator): Promise<Uint8Array | null> {
        return appAsset.readAssetBytes(locator);
    }

    static async delete(locator: AssetLocator): Promise<void> {
        await appAsset.deleteAsset(locator);
        await AssetService.evictUrlCacheForKey(assetRegistryId(locator));
    }

    static async deleteOwnerAssets(owner: AssetOwner): Promise<void> {
        await appAsset.deleteOwnerAssets(owner);
        await AssetService.evictUrlCacheWhere(
            (locator) =>
                locator.scopeType === owner.scopeType &&
                locator.scopeId === owner.scopeId &&
                locator.ownerTable === owner.ownerTable &&
                locator.ownerId === owner.ownerId
        );
    }

    static async deleteScopeAssets(scope: DataScope): Promise<void> {
        await appAsset.deleteScopeAssets(scope);
        await AssetService.evictUrlCacheWhere(
            (locator) => locator.scopeType === scope.scopeType && locator.scopeId === scope.scopeId
        );
    }

    static async markRemote(locator: AssetLocator): Promise<void> {
        await appAsset.markAssetRemote(locator);
        await updateOwnerEntryStatus(locator, 'remote');
        AssetService.scheduleEviction();
    }

    static async markLocal(locator: AssetLocator): Promise<void> {
        await appAsset.markAssetLocal(locator);
        await updateOwnerEntryStatus(locator, 'local');
    }

    static async markRemoteBatch(locators: AssetLocator[]): Promise<void> {
        await appAsset.markAssetsRemote(locators);
        await Promise.all(locators.map((locator) => updateOwnerEntryStatus(locator, 'remote')));
        AssetService.scheduleEviction();
    }

    static async markLocalBatch(locators: AssetLocator[]): Promise<void> {
        await appAsset.markAssetsLocal(locators);
        await Promise.all(locators.map((locator) => updateOwnerEntryStatus(locator, 'local')));
    }

    static async getLocalAssets(scope: DataScope): Promise<AssetRegistryRecord[]> {
        return appAsset.getAllLocalAssets(scope);
    }

    static async getRemoteAssets(scope: DataScope): Promise<AssetRegistryRecord[]> {
        return appAsset.getAllRemoteAssets(scope);
    }

    static clear(): void {
        for (const entry of AssetService.urlCache.values()) {
            if (entry.url) void appAsset.revokeRenderUrl(entry.url);
        }
        AssetService.urlCache.clear();
        AssetService.pendingLoads.clear();
    }

    static async evictCache(): Promise<void> {
        if (AssetService.isEvictionPaused) return;

        const remoteAssets = await appAsset.getAllRemoteAssets();
        const totalSize = remoteAssets.reduce((sum, record) => sum + record.size, 0);
        if (totalSize <= CACHE_HIGH_WATERMARK) return;

        const toEvict: AssetRegistryRecord[] = [];
        let remaining = totalSize;
        for (const entry of remoteAssets) {
            if (remaining <= CACHE_LOW_WATERMARK) break;
            if (AssetService.urlCache.has(entry.id)) continue;
            toEvict.push(entry);
            remaining -= entry.size;
        }

        await Promise.allSettled(toEvict.map((entry) => AssetService.delete(entry)));
    }

    static stopEviction(): void {
        AssetService.isEvictionPaused = true;
        if (AssetService.evictionTimer) {
            clearTimeout(AssetService.evictionTimer);
            AssetService.evictionTimer = null;
        }
    }

    static resumeEviction(): void {
        AssetService.isEvictionPaused = false;
        AssetService.scheduleEviction();
    }

    private static scheduleEviction(): void {
        if (AssetService.isEvictionPaused) return;
        if (AssetService.evictionTimer) return;
        AssetService.evictionTimer = setTimeout(() => {
            AssetService.evictionTimer = null;
            void AssetService.evictCache();
        }, AssetService.EVICTION_DEBOUNCE_MS);
    }
}
