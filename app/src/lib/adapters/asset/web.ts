/**
 * Web Asset Adapter — KeiAI
 *
 * Implements IAssetAdapter using a dedicated Dexie database for asset metadata
 * plus appStorage for binary blobs. This matches the user adapter pattern:
 * asset storage owns its own schema instead of routing through the generic DB adapter.
 */

import Dexie, { type Table } from 'dexie';
import { appStorage } from '$lib/adapters/storage';
import { AssetWriteEventEmitter } from './events';
import type {
	IAssetAdapter,
	AssetRecord,
	AssetRegistryRecord,
	AssetRegistryParams,
	AssetStatus,
	AssetWriteEventListener,
	AssetWriteOptions,
	AssetTableName,
	AssetWriteOperation
} from './types';

class AssetDexie extends Dexie {
	assets!: Table<AssetRecord, string>;
	assetRegistry!: Table<AssetRegistryRecord, string>;

	constructor() {
		super('KeiAssets');
		this.version(1).stores({
			assets: 'id, userId, updatedAt, isDeleted',
			assetRegistry: 'id, userId, [userId+status], kind, lastAccessedAt'
		});
	}
}

const assetDB = new AssetDexie();

export class WebAssetAdapter implements IAssetAdapter {
	private readonly writeEvents = new AssetWriteEventEmitter();

	subscribeWriteEvents(listener: AssetWriteEventListener): () => void {
		return this.writeEvents.subscribe(listener);
	}

	private emitWriteEvent(
		tableName: AssetTableName,
		operation: AssetWriteOperation,
		ids: string[],
		options?: AssetWriteOptions
	): void {
		this.writeEvents.emit({
			tableName,
			operation,
			ids,
			origin: options?.origin ?? 'local'
		});
	}

	// ── Metadata (assets table) ──────────────────────────────────────

	async getAsset(id: string): Promise<AssetRecord | undefined> {
		return assetDB.assets.get(id);
	}

	async getAllAssets(userId: string): Promise<AssetRecord[]> {
		return assetDB.assets.where('userId').equals(userId).filter((record) => !record.isDeleted).sortBy('updatedAt');
	}

	async putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void> {
		await assetDB.assets.put(record);
		this.emitWriteEvent('assets', 'put', [record.id], options);
	}

	async softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
		const existing = await assetDB.assets.get(id);
		if (!existing) return;

		await assetDB.assets.put({
			...existing,
			isDeleted: true,
			updatedAt: Date.now()
		});
		this.emitWriteEvent('assets', 'softDelete', [id], options);
	}

	async getAssetsSince(userId: string, sinceUpdatedAt: number): Promise<AssetRecord[]> {
		return assetDB.assets
			.where('userId')
			.equals(userId)
			.filter((record) => record.updatedAt > sinceUpdatedAt)
			.sortBy('updatedAt');
	}

	// ── Registry (assetRegistry table) ───────────────────────────────

	async getRegistry(id: string): Promise<AssetRegistryRecord | undefined> {
		return assetDB.assetRegistry.get(id);
	}

	async getAllRegistry(userId: string, status?: AssetStatus): Promise<AssetRegistryRecord[]> {
		if (status) {
			return assetDB.assetRegistry.where('[userId+status]').equals([userId, status]).toArray();
		}

		return assetDB.assetRegistry.where('userId').equals(userId).toArray();
	}

	async putRegistry(
		id: string,
		userId: string,
		params: Partial<AssetRegistryParams>,
		options?: AssetWriteOptions
	): Promise<void> {
		const existing = await this.getRegistry(id);
		const now = Date.now();

		if (existing) {
			const updated: AssetRegistryRecord = {
				...existing,
				...params,
				updatedAt: now
			};
			await assetDB.assetRegistry.put(updated);
		} else {
			const entry: AssetRegistryRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				status: params.status ?? 'local',
				kind: params.kind ?? 'private',
				lastAccessedAt: params.lastAccessedAt ?? now,
				size: params.size ?? 0
			};
			await assetDB.assetRegistry.put(entry);
		}

		this.emitWriteEvent('assetRegistry', 'put', [id], options);
	}

	async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
		await assetDB.assetRegistry.delete(id);
		this.emitWriteEvent('assetRegistry', 'delete', [id], options);
	}

	// ── Blobs (appStorage) ───────────────────────────────────────────

	async writeBlob(id: string, data: Uint8Array): Promise<void> {
		await appStorage.write(`assets/${id}`, data);
	}

	async readBlob(id: string): Promise<Uint8Array | null> {
		return appStorage.read(`assets/${id}`);
	}

	async deleteBlob(id: string): Promise<void> {
		await appStorage.delete(`assets/${id}`);
	}

	async blobExists(id: string): Promise<boolean> {
		return appStorage.exists(`assets/${id}`);
	}

	async getBlobUrl(id: string): Promise<string | null> {
		return appStorage.getRenderUrl(`assets/${id}`);
	}

	async revokeBlobUrl(url: string): Promise<void> {
		await appStorage.revokeRenderUrl(url);
	}

	async purgeUserAssets(userId: string): Promise<void> {
		const [assets, registry] = await Promise.all([
			assetDB.assets.where('userId').equals(userId).toArray(),
			assetDB.assetRegistry.where('userId').equals(userId).toArray()
		]);

		const ids = new Set<string>([
			...assets.map((record) => record.id),
			...registry.map((record) => record.id)
		]);

		for (const id of ids) {
			await this.deleteBlob(id).catch(() => undefined);
		}

		await assetDB.transaction('rw', assetDB.assets, assetDB.assetRegistry, async () => {
			await assetDB.assets.where('userId').equals(userId).delete();
			await assetDB.assetRegistry.where('userId').equals(userId).delete();
		});
	}

	// ── Compound Operations ──────────────────────────────────────────

	async purgeAssetLocally(id: string): Promise<void> {
		await this.deleteRegistry(id);
		await this.deleteBlob(id);
		await this.softDeleteAsset(id);
	}

	async applySyncedRecord(record: AssetRecord, userId: string): Promise<AssetRecord | null> {
		const local = await this.getAsset(record.id);
		const remoteAt = record.updatedAt ?? 0;
		const localAt = local?.updatedAt ?? 0;

		// LWW: skip if local is same or newer
		if (local && remoteAt <= localAt) return null;

		if (record.isDeleted) {
			// Server says deleted → purge local blob and registry
			await this.deleteRegistry(record.id, { origin: 'sync' });
			await this.deleteBlob(record.id);
			// Upsert the deleted metadata record so we remember the tombstone
			await this.putAsset(record, { origin: 'sync' });
			return record;
		}

		// Upsert metadata
		await this.putAsset(record, { origin: 'sync' });

		// Seed registry if not already tracked (lazy download on first access)
		const existing = await this.getRegistry(record.id);
		if (!existing) {
			await this.putRegistry(record.id, userId, {
				status: 'remote',
				kind: 'private', // Unknown here; will be corrected on first access
				size: 0
			}, { origin: 'sync' });
		}

		return record;
	}
}

export const webAsset = new WebAssetAdapter();
