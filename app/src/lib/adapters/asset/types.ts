/**
 * Asset Adapter Interface — KeiAI
 *
 * Unified local storage adapter for asset management.
 * Manages two storage layers behind a single interface:
 *   - assets table (plaintext metadata, DataRecord with kind/status/hash/encKey)
 *   - assetRegistry table (device-local cache metadata: size, accessedAt)
 *
 * Binary blobs are stored via appStorage (OPFS or Tauri filesystem) directly.
 * The adapter is storage-only: no PB communication, no encryption logic.
 * Encryption is handled by the caller (AssetService / AssetSyncEngine).
 */

import type { BaseRecord, DataRecord, DatabaseMutationOrigin } from '$lib/adapters/db';

// ─── Types ───────────────────────────────────────────────────────────

export type AssetKindPlain = 'private' | 'inlay' | 'public';

export type AssetStatus = 'local' | 'remote';

export type AssetRecord = DataRecord;

/**
 * Plaintext fields stored inside the assets table's data field.
 * Domain data: kind, status, hash, encKey.
 */
export interface AssetFields {
    kind: AssetKindPlain;
    status: AssetStatus;
    hash: string;
    encKey: string;
}

/**
 * Registry record — device-local cache metadata + routing fields.
 * kind/status are cached here for queue filtering without joining the assets table.
 * hash/encKey are read from the assets table only when needed for actual I/O.
 *
 * Invariants:
 * - Active registry (isDeleted=false) ⊆ storage (every entry has a blob)
 * - isDeleted=true entries serve as a persistent delete queue for the sync engine
 */
export interface AssetRegistryRecord extends BaseRecord {
    kind: AssetKindPlain;
    status: AssetStatus;
    size: number; // blob size in bytes (0 for delete queue entries)
    accessedAt: number; // LRU eviction timestamp
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

    /** Get asset records updated since a given timestamp (includes deleted). */
    getAssetsSince(userId: string, sinceUpdatedAt: number): Promise<AssetRecord[]>;

    // ── Registry (assetRegistry table) ───────────────────────────────

    /** Get a registry entry by asset ID. */
    getRegistry(id: string): Promise<AssetRegistryRecord | undefined>;

    /** Get all active (non-deleted) registry entries for a user. */
    getAllRegistry(userId: string): Promise<AssetRegistryRecord[]>;

    /** Get all deleted registry entries for a user (the delete queue). */
    getDeletedRegistry(userId: string): Promise<AssetRegistryRecord[]>;

    /** Get registry entries by status, optionally filtered by kinds. */
    getRegistryByStatus(
        userId: string,
        status: AssetStatus,
        kinds?: AssetKindPlain[]
    ): Promise<AssetRegistryRecord[]>;

    /** Insert or update a registry record (full record). */
    putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void>;

    /** Soft-delete a registry entry (isDeleted = true, preserves status/hash for delete queue). */
    softDeleteRegistry(id: string, options?: AssetWriteOptions): Promise<void>;

    /** Hard-delete a registry entry (called after delete queue processing). */
    deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void>;
}
