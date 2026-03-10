/**
 * Asset Types — KeiAI v2
 *
 * Asset system with E2EE, local-first, and deduplication.
 * AssetFields is defined in adapters/asset/types.ts (shared with registry).
 */

// Re-export for service-layer convenience
export type { AssetFields, AssetKindPlain as AssetKind } from '$lib/adapters/asset';

// ─── Compression Result ─────────────────────────────────────────────────────

export interface CompressAndHashResult {
	blob: Blob; // Compressed WebP blob
	hash: string; // SHA256 of compressed bytes
	encKey: string; // SHA256(compressed + FIXED_SALT)
	width: number;
	height: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** CDN base URL for asset delivery */
export const CDN_BASE_URL = 'https://cdn.keiai.ai/assets';

/** Fixed salt for encKey generation - enables deterministic key derivation */
export const FIXED_SALT = 'keiai-private-asset-salt-v1';

/** Max file size for upload (5MB) */
export const MAX_ASSET_SIZE = 5 * 1024 * 1024;

/** Target compression dimensions */
export const MAX_IMAGE_WIDTH = 1920;
export const MAX_IMAGE_HEIGHT = 1080;

/** Target quality for WebP compression (0-100) */
export const WEBP_QUALITY = 0.85;

// ─── Cache Watermarks ──────────────────────────────────────────────────────

/** High watermark: start eviction when cache exceeds this size */
export const CACHE_HIGH_WATERMARK = 500 * 1024 * 1024; // 500 MB

/** Low watermark: evict until cache is below this size */
export const CACHE_LOW_WATERMARK = 400 * 1024 * 1024; // 400 MB
