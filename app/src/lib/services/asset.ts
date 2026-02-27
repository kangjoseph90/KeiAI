import { localDB } from '../db/index.js';
import type { AssetRecord } from '../db/index.js';
import { getActiveSession } from '../session.js';

// ─── Service ─────────────────────────────────────────────────────────

export class AssetService {
	/** Get an asset by ID (hash or UUID) */
	static async get(id: string): Promise<AssetRecord | null> {
		const record = await localDB.getAsset(id);
		return record ?? null;
	}

	/** Get an asset URL for rendering (CDN URL or local ObjectURL) */
	static async getUrl(id: string): Promise<string | null> {
		const record = await localDB.getAsset(id);
		if (!record) return null;

		if (record.cdnUrl) return record.cdnUrl;
		if (record.selfHostedUrl) return record.selfHostedUrl;
		return URL.createObjectURL(record.data);
	}

	/** Save a regular asset (content-hash ID for dedup) */
	static async saveRegular(
		data: Blob,
		mimeType: string,
		visibility: 'private' | 'public' = 'private'
	): Promise<AssetRecord> {
		const { userId } = getActiveSession();
		const hash = await hashBlob(data);
		const existing = await localDB.getAsset(hash);
		if (existing) return existing;

		const record: AssetRecord = {
			id: hash,
			userId,
			kind: 'regular',
			visibility,
			mimeType,
			data,
			createdAt: Date.now()
		};
		await localDB.putAsset(record);
		return record;
	}

	/** Save an inlay asset (content-hash, always private) */
	static async saveInlay(data: Blob, mimeType: string): Promise<AssetRecord> {
		const { userId } = getActiveSession();
		const hash = await hashBlob(data);
		const existing = await localDB.getAsset(hash);
		if (existing) return existing;

		const record: AssetRecord = {
			id: hash,
			userId,
			kind: 'inlay',
			visibility: 'private',
			mimeType,
			data,
			createdAt: Date.now()
		};
		await localDB.putAsset(record);
		return record;
	}

	/** Promote private regular asset to public (after CDN upload) */
	static async promoteToPublic(id: string, cdnUrl: string): Promise<void> {
		const record = await localDB.getAsset(id);
		if (!record || record.kind !== 'regular') return;

		record.visibility = 'public';
		record.cdnUrl = cdnUrl;
		await localDB.putAsset(record);
	}

	/** Delete an asset */
	static async delete(id: string): Promise<void> {
		await localDB.deleteAsset(id);
	}

	/** List all assets for current user */
	static async list(kind?: 'regular' | 'inlay'): Promise<AssetRecord[]> {
		const { userId } = getActiveSession();
		return await localDB.getAssetsByUser(userId, kind);
	}
}

// ─── Internal ────────────────────────────────────────────────────────

async function hashBlob(blob: Blob): Promise<string> {
	const buffer = await blob.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}
