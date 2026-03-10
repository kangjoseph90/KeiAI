/**
 * Asset Service — KeiAI v2
 *
 * Local-first asset system with E2EE, deduplication, and LRU caching.
 * Bridges storage adapter (OPFS) and database (metadata + registry).
 *
 * All public methods are the single source of truth for asset operations.
 */

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../../session';
import { localDB, type AssetRecord, type AssetRegistryRecord } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import {
	type AssetKind,
	type AssetFields,
	CACHE_HIGH_WATERMARK,
	CACHE_LOW_WATERMARK
} from './types';
import {
	preprocessImage,
	deriveAssetKey,
	encryptAsset,
	decryptAsset,
	getRemoteURL,
	isValidImageHeader
} from './util';
import { sha256 } from '$lib/crypto';
import { AppError } from '$lib/shared/errors';
import { generateId } from '$lib/shared/id';
import { appHttp } from '$lib/adapters/http';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Decrypt AssetFields from encrypted record */
async function decryptFields(masterKey: CryptoKey, record: AssetRecord): Promise<AssetFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((raw: string) => JSON.parse(raw) as AssetFields)
		.catch((error: unknown) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt asset record', error);
		});
}

/** Update encrypted AssetFields in the assets table */
async function updateFields(id: string, masterKey: CryptoKey, fields: AssetFields): Promise<void> {
	const record = await localDB.getRecord<AssetRecord>('assets', id);
	if (!record) return;

	const enc = await encrypt(masterKey, JSON.stringify(fields));
	record.encryptedData = enc.ciphertext;
	record.encryptedDataIV = enc.iv;
	record.updatedAt = Date.now();

	await localDB.putRecord('assets', record);
}

/**
 * Unified helper to create or update entry in assetRegistry.
 * Syncs local status, access time, and metadata.
 */
async function syncRegistry(
	id: string,
	userId: string,
	params: Partial<AssetRegistryRecord>
): Promise<void> {
	const existing = await localDB.getRecord<AssetRegistryRecord>('assetRegistry', id);
	const now = Date.now();

	if (existing) {
		const updated = {
			...existing,
			...params,
			updatedAt: now
		};
		await localDB.putRecord('assetRegistry', updated);
	} else {
		// New entry
		const entry: AssetRegistryRecord = {
			id,
			userId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			status: 'local',
			kind: 'private',
			lastAccessedAt: now,
			size: 0,
			...params
		};
		await localDB.putRecord('assetRegistry', entry);
	}
}

// ─── Asset Service ─────────────────────────────────────────────────────────

export class AssetService {
	// ── Read ──────────────────────────────────────────────────────────────

	/**
	 * Get a renderable URL for an asset.
	 *
	 * Flow:
	 *   1. Local storage hit → return render URL, refresh lastAccessedAt
	 *   2. Local storage miss:
	 *      a. public → return CDN URL directly (no download)
	 *      b. private/inlay with hash → download blob, detect if encrypted,
	 *         decrypt if needed, store locally, update registry, return render URL
	 */
	static async getAssetUrl(id: string): Promise<string | null> {
		const { masterKey, userId } = getActiveSession();

		// 1. Fast path: already on disk
		if (await appStorage.exists(id)) {
			await syncRegistry(id, userId, { lastAccessedAt: Date.now() });
			return appStorage.getRenderUrl(id);
		}

		// 2. Need to look up the record to find hash
		const record = await localDB.getRecord<AssetRecord>('assets', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		if (!fields.hash) return null;

		const url = getRemoteURL(fields.hash);

		try {
			const response = await appHttp.fetch(url);
			if (!response.ok) throw new AppError('NOT_FOUND', `CDN returned ${response.status}`);

			const encryptedBytes = new Uint8Array(await response.arrayBuffer());
			const isWebP = isValidImageHeader(encryptedBytes);

			let finalBytes: Uint8Array;
			if (isWebP) {
				finalBytes = encryptedBytes;
				// Healing on Read: if server has it as public but we thought private
				if (fields.kind !== 'public') {
					fields.kind = 'public';
					await updateFields(id, masterKey, fields).catch(console.error);
					await syncRegistry(id, userId, { status: 'remote', kind: 'public' }).catch(console.error);
				}
			} else {
				finalBytes = await decryptAsset(encryptedBytes, fields.encKey);
			}

			if (!isValidImageHeader(finalBytes)) {
				throw new AppError('ASSET_ERROR', 'Downloaded data is not a valid image');
			}

			// Store and cache
			await appStorage.write(id, finalBytes);
			await syncRegistry(id, userId, {
				status: 'remote',
				kind: fields.kind,
				size: finalBytes.byteLength,
				lastAccessedAt: Date.now()
			});

			return appStorage.getRenderUrl(id);
		} catch (error) {
			console.error(`Failed to download asset ${id}:`, error);
			return null;
		}
	}

	/** Revoke a previously obtained render URL */
	static async revokeAssetUrl(url: string): Promise<void> {
		await appStorage.revokeRenderUrl(url);
	}

	// ── Write ─────────────────────────────────────────────────────────────

	/**
	 * Create a new local asset.
	 */
	static async createAsset(file: File, kind: AssetKind): Promise<string> {
		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		// 1. Standardize image (convert/resize if needed)
		const { blob, width, height } = await preprocessImage(file);

		// 2. Read final bytes for indexing and hashing
		const buffer = await blob.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		// 3. Identifiers: SHA256 of binary, and Encryption Key
		const hash = await sha256(buffer);
		const encKey = await deriveAssetKey(bytes);

		const fields: AssetFields = { kind, hash, encKey, mimeType: blob.type || 'image/webp' };
		const enc = await encrypt(masterKey, JSON.stringify(fields));

		try {
			// Write binary and metadata
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

			await syncRegistry(id, userId, { kind, status: 'local', size: bytes.byteLength });
			return id;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('ASSET_ERROR', 'Failed to create asset', error);
		}
	}

	/**
	 * Delete asset from storage and soft-delete metadata.
	 */
	static async deleteAsset(id: string): Promise<void> {
		try {
			await localDB.deleteRecord('assetRegistry', id);
			await appStorage.delete(id);
			await localDB.softDeleteRecord('assets', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('ASSET_ERROR', 'Failed to delete asset', error);
		}
	}

	// ── Promotion ─────────────────────────────────────────────────────────

	/**
	 * Promote private asset to public.
	 */
	static async promoteToPublic(id: string): Promise<string> {
		const { masterKey, userId } = getActiveSession();

		const record = await localDB.getRecord<AssetRecord>('assets', id);
		if (!record || record.isDeleted) throw new AppError('ASSET_ERROR', 'Asset not found');

		const fields = await decryptFields(masterKey, record);
		if (fields.kind === 'public') return getRemoteURL(fields.hash);

		const encryptedBytes = await appStorage.read(id);
		if (!encryptedBytes) throw new AppError('ASSET_ERROR', 'Asset file not found locally');

		const decryptedBytes = await decryptAsset(encryptedBytes, fields.encKey);

		// TODO: Upload decryptedBytes to CDN as plaintext

		fields.kind = 'public';
		await updateFields(id, masterKey, fields);
		await syncRegistry(id, userId, { status: 'remote', kind: 'public' });

		return getRemoteURL(fields.hash);
	}

	// ── Cache Management ──────────────────────────────────────────────────

	/**
	 * Evict old cached files if disk usage is high.
	 */
	static async evictCacheIfNeeded(userId: string): Promise<void> {
		const all = await localDB.getAll<AssetRegistryRecord>('assetRegistry', userId);
		const remoteAssets = all.filter((r) => r.status === 'remote');

		const totalBytes = remoteAssets.reduce((sum, r) => sum + r.size, 0);
		if (totalBytes <= CACHE_HIGH_WATERMARK) return;

		const sorted = remoteAssets.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
		let freed = 0;
		const target = totalBytes - CACHE_LOW_WATERMARK;

		for (const entry of sorted) {
			if (freed >= target) break;
			await appStorage.delete(entry.id);
			await localDB.deleteRecord('assetRegistry', entry.id);
			freed += entry.size;
		}
	}
}
