import type { AssetLocator } from '$lib/adapters/asset';

/**
 * Asset Types - KeiAI
 *
 * v4 treats parent records as the sync-visible asset manifest. The local asset
 * adapter only tracks cached blobs by owner/hash.
 */
export type { AssetFields, AssetEntries, AssetStatus } from '$lib/types/asset';
export type { AssetLocator, AssetOwner, AssetRegistryRecord } from '$lib/adapters/asset';

export type AssetReadLocator = AssetLocator & { encKey: string };

// Compression Result
export interface CompressAndHashResult {
    blob: Blob;
    hash: string;
    encKey: string;
    width: number;
    height: number;
}

// Constants
export const MAX_ASSET_SIZE = 5 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 1920;
export const MAX_IMAGE_HEIGHT = 1080;
export const WEBP_QUALITY = 0.85;

// Cache Watermarks
export const CACHE_HIGH_WATERMARK = 500 * 1024 * 1024;
export const CACHE_LOW_WATERMARK = 400 * 1024 * 1024;
