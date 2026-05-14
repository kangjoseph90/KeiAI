/**
 * Asset Adapter Interface — KeiAI
 *
 * Unified local storage adapter for asset management.
 * Manages two storage layers behind a single interface:
 *   - assets table (plaintext metadata, DataRecord with kind/status/hash/encKey)
 *   - assetRegistry table (device-local cache metadata + denormalized cache indexes)
 *
 * Binary blobs are stored via appStorage (OPFS or Tauri filesystem) directly.
 * The adapter is storage-only: no PB communication, no encryption logic.
 * Encryption is handled by the caller (AssetService / AssetSyncEngine).
 */

import type { BaseRecord, DataRecord, DataScope, DatabaseMutationOrigin } from '$lib/adapters/db';

// ─── Types ───────────────────────────────────────────────────────────

export type AssetKind = 'resource' | 'inlay';

export type AssetStatus = 'local' | 'remote';

export type AssetRecord = DataRecord;

/**
 * Plaintext fields stored inside the assets table's data field.
 * Domain data: kind, status, hash, encKey.
 */
export interface AssetFields {
    kind: AssetKind;
    status: AssetStatus;
    hash: string;
    encKey: string;
}

/**
 * Registry record — device-local cache metadata + denormalized query indexes.
 * kind/status are copied from the assets table to make LRU eviction, optional
 * inlay sync, and upload queue scans cheap without joining against assets.
 * The assets table remains the source of truth when values disagree.
 *
 * Invariants:
 * - Active registry (isDeleted=false) ⊆ storage (every entry has a blob)
 * - kind/status are local cache indexes; sync decisions must re-check assets.data
 */
export interface AssetRegistryRecord extends BaseRecord {
    kind: AssetKind;
    status: AssetStatus;
    size: number; // cached blob size in bytes
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

    /** Ensure all pending writes are committed. */
    flush(): Promise<void>;

    // ── Metadata (assets table) ──────────────────────────────────────

    /** Get an encrypted asset record by ID. */
    getAsset(id: string): Promise<AssetRecord | undefined>;

    /** Get all non-deleted asset records for a scope. */
    getAllAssets(scope: DataScope): Promise<AssetRecord[]>;

    /** Insert or update an encrypted asset record. */
    putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void>;

    /** Soft-delete an asset record (isDeleted = true). */
    softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void>;

    /** Delete an asset record from storage. */
    deleteAsset(id: string, options?: AssetWriteOptions): Promise<void>;

    /** Get asset records updated since a given timestamp (includes deleted). */
    getAssetsSince(scope: DataScope, sinceUpdatedAt: number): Promise<AssetRecord[]>;

    // ── Registry (assetRegistry table) ───────────────────────────────

    /** Get a registry entry by asset ID. */
    getRegistry(id: string): Promise<AssetRegistryRecord | undefined>;

    /** Get all active (non-deleted) registry entries for a scope. */
    getAllRegistry(scope: DataScope): Promise<AssetRegistryRecord[]>;

    /** Get registry entries by status, optionally filtered by kinds. */
    getRegistryByStatus(
        scope: DataScope,
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]>;

    /** Get registry entries by status across all scopes. Used for device-local cache eviction. */
    getAllRegistryByStatus(
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]>;

    /** Insert or update a registry record (full record). */
    putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void>;

    /** Delete a registry entry and leave assets as the logical source of truth. */
    deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void>;

    /** Run a block of work inside a database transaction. */
    transaction<R>(
        tables: AssetTableName[],
        mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R>;
}
