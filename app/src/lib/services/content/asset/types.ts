/**
 * Asset Types — KeiAI v2
 *
 * Asset system with E2EE, local-first, and deduplication.
 */

// ─── Asset Kind ─────────────────────────────────────────────────────────────

export type AssetKind = 'private' | 'inlay' | 'public';

// ─── Asset Fields (stored in EncryptedRecord) ───────────────────────────────

/**
 * Encrypted fields stored in the assets table.
 * Decrypted with master key to access actual asset metadata.
 */
export interface AssetFields {
	kind: AssetKind;
	hash: string; // SHA256(plaintext) — CDN URL path
	encKey: string; // SHA256(plaintext + FIXED_SALT) — file encryption key
	mimeType: string;
}

// ─── Compression Result ─────────────────────────────────────────────────────

export interface CompressAndHashResult {
	blob: Blob; // Compressed WebP blob
	hash: string; // SHA256 of original plaintext
	encKey: string; // SHA256(plaintext + FIXED_SALT)
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
