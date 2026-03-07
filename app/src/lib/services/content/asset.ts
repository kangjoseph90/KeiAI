/**
 * Asset Service — KeiAI
 *
 * Bridges IDatabaseAdapter (metadata) and IStorageAdapter (binary files).
 * All public methods are the single source of truth for asset operations.
 *
 * Asset lifecycle:
 *   createAsset → stores binary in IStorageAdapter + EncryptedRecord in DB
 *   getAssetUrl  → checks local storage → falls back to remoteUrl if needed
 *   deleteAsset  → hard-deletes binary + soft-deletes DB record
 *   evict        → LRU cache cleanup when total cache exceeds high watermark
 */

import { encrypt, decrypt } from '../../crypto/index.js';
import { getActiveSession } from '../session.js';
import { localDB, type AssetRecord, type CacheRegistryRecord } from '../../adapters/db/index.js';
import { appStorage } from '../../adapters/storage/index.js';
import { AppError } from '../../shared/errors.js';
import { generateId } from '../../shared/id.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Evict cache down to LOWWATERMARK when total exceeds HIGHWATERMARK */
const CACHEHIGHWATERMARK = 500 * 1024 * 1024; // 500 MB
const CACHELOWWATERMARK  = 400 * 1024 * 1024; // 400 MB

// ─── Asset field types (stored inside encryptedData) ─────────────────────────

export type AssetKind = 'private' | 'inlay' | 'public';

export interface AssetFields {
	kind: AssetKind;
	mimeType: string;
	/** Absent = local-only asset. Present = remote (cached or CDN). */
	remoteUrl?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function decryptAssetFields(
	masterKey: CryptoKey,
	record: AssetRecord
): Promise<AssetFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((raw) => JSON.parse(raw) as AssetFields)
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt asset record', error);
		});
}

function toBytes(data: Uint8Array | Blob): Promise<Uint8Array> {
	if (data instanceof Uint8Array) return Promise.resolve(data);
	return data.arrayBuffer().then((buf) => new Uint8Array(buf));
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AssetService {

	// ── Read ──────────────────────────────────────────────────────────────

	/**
	 * Get a renderable URL for an asset.
	 *
	 * Flow:
	 *   1. Local storage hit → return render URL, refresh lastAccessedAt
	 *   2. Local storage miss:
	 *      a. public  → return CDN remoteUrl directly (no download)
	 *      b. private/inlay with remoteUrl → download encrypted blob, decrypt,
	 *         store locally, register in cacheRegistry, return render URL
	 *      c. local-only with no file → return null (data loss / not yet written)
	 */
	static async getAssetUrl(id: string): Promise<string | null> {
		const { masterKey, userId } = getActiveSession();

		// 1. Fast path: already on disk
		const isLocal = await appStorage.exists(id);
		if (isLocal) {
			// Refresh LRU timestamp
			await AssetService.touchCache(id);
			return appStorage.getRenderUrl(id);
		}

		// 2. Need to look up the record to find remoteUrl
		const record = await localDB.getRecord<AssetRecord>('assets', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptAssetFields(masterKey, record);

		// 2a. Public → CDN URL, no local download needed
		if (fields.kind === 'public') {
			return fields.remoteUrl ?? null;
		}

		// 2b. Private / inlay with remoteUrl → download & cache
		if (fields.remoteUrl) {
			// TODO: download encrypted blob from object storage (server)
			// const encBlob = await serverApi.downloadAsset(fields.remoteUrl);
			// const decrypted = await crypto.decryptBytes(masterKey, encBlob);
			// Mocked for now — return null until server impl is ready:
			const decrypted = null as Uint8Array | null;

			if (!decrypted) {
				// Download not yet implemented; return null for now
				return null;
			}

			await appStorage.write(id, decrypted);
			await AssetService.registerCache(id, userId, decrypted.byteLength);
			return appStorage.getRenderUrl(id);
		}

		// 2c. Local-only but file is gone → shouldn't happen in normal use
		return null;
	}

	/** Revoke a previously obtained render URL (important for Web OPFS Object URLs) */
	static async revokeAssetUrl(url: string): Promise<void> {
		await appStorage.revokeRenderUrl(url);
	}

	// ── Write ─────────────────────────────────────────────────────────────

	/**
	 * Create a new local asset.
	 * Stores binary in IStorageAdapter and saves an EncryptedRecord in the DB.
	 * Returns the new asset UUID.
	 */
	static async createAsset(
		data: Blob | Uint8Array,
		kind: AssetKind,
		mimeType: string
	): Promise<string> {
		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		const bytes = await toBytes(data);
		const fields: AssetFields = { kind, mimeType };
		const enc = await encrypt(masterKey, JSON.stringify(fields));

		try {
			// Write binary first — if DB write fails we'd rather have an orphan
			// file than a DB record pointing at nothing.
			await appStorage.write(id, bytes);

			await localDB.putRecord<AssetRecord>('assets', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create asset', error);
		}

		return id;
	}

	/**
	 * Hard-delete binary from storage + soft-delete the DB record.
	 * Safe to call for both local-only and cached remote assets.
	 */
	static async deleteAsset(id: string): Promise<void> {
		try {
			// Remove from cache registry if present
			await localDB.deleteRecord('cacheRegistry', id);
			// Hard-delete binary (frees disk space immediately)
			await appStorage.delete(id);
			// Soft-delete metadata record (preserved for Blind Sync tombstone)
			await localDB.softDeleteRecord('assets', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete asset', error);
		}
	}

	// ── Promotion (TODO) ──────────────────────────────────────────────────

	/**
	 * Promote a private/inlay asset to public (Hub sharing).
	 * Uploads binary to CDN, updates the asset record kind → 'public'.
	 *
	 * TODO: implement actual CDN upload and server communication.
	 */
	static async promoteToPublic(id: string): Promise<string> {
		// TODO:
		//   1. appStorage.read(id) → bytes
		//   2. SHA-256(bytes) → sha256
		//   3. serverApi.uploadPublicAsset(sha256, bytes) → cdnUrl
		//   4. Update asset record: kind → 'public', remoteUrl → cdnUrl
		//   5. appStorage.delete(id), registerCache removes local binary
		//   6. serverApi.releasePrivateQuota(id)
		// Mocked:
		return 'https://cdn.example.com/mock-public-url';
	}

	// ── LRU Cache Eviction ────────────────────────────────────────────────

	/**
	 * Evict cached remote asset files that haven't been accessed recently
	 * until total cache size drops below CACHELOWWATERMARK.
	 * Only entries registered in cacheRegistry are eligible for eviction.
	 */
	static async evictCacheIfNeeded(): Promise<void> {
		const { userId } = getActiveSession();
		const all = await localDB.getAll<CacheRegistryRecord>('cacheRegistry', userId);

		const totalBytes = all.reduce((sum, r) => sum + r.size, 0);
		if (totalBytes <= CACHEHIGHWATERMARK) return;

		// Sort oldest-accessed first
		const sorted = all.slice().sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

		let freed = 0;
		const target = totalBytes - CACHELOWWATERMARK;

		for (const entry of sorted) {
			if (freed >= target) break;
			await appStorage.delete(entry.id);
			await localDB.deleteRecord('cacheRegistry', entry.id);
			freed += entry.size;
		}
	}

	// ── Private Helpers ───────────────────────────────────────────────────

	/** Register a downloaded remote asset in the LRU cache registry */
	private static async registerCache(id: string, userId: string, size: number): Promise<void> {
		const now = Date.now();
		const entry: CacheRegistryRecord = {
			id,
			userId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			lastAccessedAt: now,
			size
		};
		await localDB.putRecord<CacheRegistryRecord>('cacheRegistry', entry);
	}

	/** Refresh lastAccessedAt for an existing cache entry (if it exists) */
	private static async touchCache(id: string): Promise<void> {
		const existing = await localDB.getRecord<CacheRegistryRecord>('cacheRegistry', id);
		if (!existing) return; // local-only asset — not in cache registry
		existing.lastAccessedAt = Date.now();
		await localDB.putRecord('cacheRegistry', existing);
	}
}