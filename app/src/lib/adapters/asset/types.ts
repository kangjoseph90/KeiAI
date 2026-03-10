/**
 * Asset Adapter Interface — KeiAI
 *
 * Unified local storage adapter for asset management.
 * Combines three storage layers behind a single interface:
 *   - assets table (encrypted metadata, EncryptedRecord)
 *   - assetRegistry table (plaintext local-only status/cache tracking)
 *   - appStorage (binary blobs in OPFS or Tauri filesystem)
 *
 * This adapter owns all three layers. Neither DataSyncEngine nor AssetService
 * should access these tables directly — they go through this adapter.
 *
 * The adapter is storage-only: no PB communication, no encryption logic.
 * Encryption is handled by the caller (AssetService / AssetSyncEngine).
 */

import type { BaseRecord, EncryptedRecord, DatabaseMutationOrigin } from '$lib/adapters/db';

// ─── Types ───────────────────────────────────────────────────────────

export type AssetKindPlain = 'private' | 'inlay' | 'public';

export type AssetStatus = 'local' | 'remote' | 'deleting';

export type AssetRecord = EncryptedRecord;

export interface AssetRegistryRecord extends BaseRecord {
	kind: AssetKindPlain;
	status: AssetStatus;
	lastAccessedAt: number;
	size: number;
}

export type AssetTableName = 'assets' | 'assetRegistry';

export type AssetWriteOperation = 'put' | 'delete' | 'softDelete';

export interface AssetWriteOptions {
	origin?: DatabaseMutationOrigin;
}

export interface AssetWriteEvent {
	tableName: AssetTableName;
	operation: AssetWriteOperation;
	ids: string[];
	origin: DatabaseMutationOrigin;
}

export type AssetWriteEventListener = (events: AssetWriteEvent[]) => void;

export interface AssetRegistryParams {
	kind: AssetKindPlain;
	status: AssetStatus;
	size: number;
	lastAccessedAt?: number;
}

// ─── Interface ───────────────────────────────────────────────────────

export interface IAssetAdapter {
	/** Subscribe to asset-local write events. */
	subscribeWriteEvents(listener: AssetWriteEventListener): () => void;

	// ── Metadata (assets table) ──────────────────────────────────────

	/** Get an encrypted asset record by ID. */
	getAsset(id: string): Promise<AssetRecord | undefined>;

	/** Get all non-deleted asset records for a user. */
	getAllAssets(userId: string): Promise<AssetRecord[]>;

	/** Insert or update an encrypted asset record. */
	putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void>;

	/** Soft-delete an asset record (isDeleted = true). */
	softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void>;

	/**
	 * Get asset records updated since a given timestamp for a user.
	 * Used by sync engine for push (finding local changes to send to server).
	 */
	getAssetsSince(userId: string, sinceUpdatedAt: number): Promise<AssetRecord[]>;

	// ── Registry (assetRegistry table) ───────────────────────────────

	/** Get a registry entry by asset ID. */
	getRegistry(id: string): Promise<AssetRegistryRecord | undefined>;

	/** Get all registry entries for a user (optionally filtered by status). */
	getAllRegistry(userId: string, status?: AssetStatus): Promise<AssetRegistryRecord[]>;

	/** Create or update a registry entry. */
	putRegistry(
		id: string,
		userId: string,
		params: Partial<AssetRegistryParams>,
		options?: AssetWriteOptions
	): Promise<void>;

	/** Hard-delete a registry entry. */
	deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void>;

	// ── Blobs (appStorage) ───────────────────────────────────────────

	/** Write binary data for an asset. */
	writeBlob(id: string, data: Uint8Array): Promise<void>;

	/** Read binary data for an asset. */
	readBlob(id: string): Promise<Uint8Array | null>;

	/** Delete binary data for an asset. */
	deleteBlob(id: string): Promise<void>;

	/** Check if binary data exists for an asset. */
	blobExists(id: string): Promise<boolean>;

	/** Get a renderable URL for the blob (blob:// or asset://). */
	getBlobUrl(id: string): Promise<string | null>;

	/** Revoke a previously created render URL. */
	revokeBlobUrl(url: string): Promise<void>;

	/** Hard-delete every local asset artifact for a user. */
	purgeUserAssets(userId: string): Promise<void>;

	// ── Compound Operations ──────────────────────────────────────────

	/**
	 * Full local cleanup for an asset: remove blob, registry, and soft-delete metadata.
	 * Called when a synced deletion arrives or when explicitly deleting.
	 */
	purgeAssetLocally(id: string): Promise<void>;

	/**
	 * Handle a synced asset record from the server.
	 * - If deleted on server → purge locally (blob + registry)
	 * - If new/updated → upsert metadata, seed registry if missing
	 *
	 * Returns the record if it was applied (newer than local), null if skipped.
	 */
	applySyncedRecord(record: AssetRecord, userId: string): Promise<AssetRecord | null>;
}
