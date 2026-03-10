import Database from '@tauri-apps/plugin-sql';
import { fromBase64, toBase64 } from '$lib/crypto/encoding';
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

/**
 * Tauri Asset Adapter
 *
 * SQLite-only storage for asset metadata (assets, assetRegistry tables).
 * Binary blobs are stored in appStorage (native FS via TauriStorageAdapter).
 *
 * Row structure mirrors the Dexie schema:
 *   - assets: encrypted metadata record (EncryptedRecord)
 *   - assetRegistry: plaintext cache status tracking
 *
 * Uint8Array properties are base64-encoded for SQLite TEXT storage.
 */

/** Raw shape of an asset record as stored in SQLite */
interface AssetSqlRow {
	id: string;
	userId: string;
	createdAt: number;
	updatedAt: number;
	isDeleted: number; // SQLite uses 0/1 for boolean
	encryptedData: string; // Base64
	encryptedDataIV: string; // Base64
}

/** Convert AssetRecord to bindings for SQLite */
function assetRecordToBindings(record: AssetRecord): AssetSqlRow {
	return {
		id: record.id,
		userId: record.userId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		isDeleted: record.isDeleted ? 1 : 0,
		encryptedData: toBase64(record.encryptedData),
		encryptedDataIV: toBase64(record.encryptedDataIV)
	};
}

/** Parse raw SQLite row back into AssetRecord */
function parseAssetRecord(row: AssetSqlRow): AssetRecord {
	return {
		id: row.id,
		userId: row.userId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		isDeleted: row.isDeleted === 1,
		encryptedData: fromBase64(row.encryptedData),
		encryptedDataIV: fromBase64(row.encryptedDataIV)
	};
}

// ─── Adapter ───────────────────────────────────────────────────────────────

export class TauriAssetAdapter implements IAssetAdapter {
	private dbPromise: Promise<Database> | null = null;
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

	// ── SQLite ───────────────────────────────────────────────────────────────

	private async getDb(): Promise<Database> {
		if (this.dbPromise) return this.dbPromise;

		this.dbPromise = (async () => {
			const db = await Database.load('sqlite:KeiLocalDB.db');
			await this.initDb(db);
			return db;
		})();

		return this.dbPromise;
	}

	private async initDb(db: Database) {
		// Assets table - encrypted metadata
		await db.execute(`
			CREATE TABLE IF NOT EXISTS assets (
				id TEXT PRIMARY KEY,
				userId TEXT NOT NULL,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL,
				isDeleted INTEGER NOT NULL DEFAULT 0,
				encryptedData TEXT,
				encryptedDataIV TEXT
			)
		`);
		await db.execute(`CREATE INDEX IF NOT EXISTS idx_assets_userId ON assets (userId)`);
		await db.execute(`CREATE INDEX IF NOT EXISTS idx_assets_updatedAt ON assets (updatedAt)`);

		// Asset registry table - cache status tracking
		await db.execute(`
			CREATE TABLE IF NOT EXISTS assetRegistry (
				id TEXT PRIMARY KEY,
				userId TEXT NOT NULL,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL,
				isDeleted INTEGER NOT NULL DEFAULT 0,
				kind TEXT NOT NULL,
				status TEXT NOT NULL,
				lastAccessedAt INTEGER NOT NULL,
				size INTEGER NOT NULL
			)
		`);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_userId ON assetRegistry (userId)`
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_userId_status ON assetRegistry (userId, status)`
		);
		await db.execute(`CREATE INDEX IF NOT EXISTS idx_assetRegistry_kind ON assetRegistry (kind)`);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_lastAccessedAt ON assetRegistry (lastAccessedAt)`
		);
	}

	// ── Metadata (assets table) ──────────────────────────────────────

	async getAsset(id: string): Promise<AssetRecord | undefined> {
		const db = await this.getDb();
		const rows = await db.select<AssetSqlRow[]>(`SELECT * FROM assets WHERE id = $1`, [id]);
		if (rows.length > 0) return parseAssetRecord(rows[0]);
		return undefined;
	}

	async getAllAssets(userId: string): Promise<AssetRecord[]> {
		const db = await this.getDb();
		const rows = await db.select<AssetSqlRow[]>(
			`SELECT * FROM assets WHERE userId = $1 AND isDeleted = 0 ORDER BY updatedAt ASC`,
			[userId]
		);
		return rows.map((row) => parseAssetRecord(row));
	}

	async putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();
		const data = assetRecordToBindings(record);

		await db.execute(
			`INSERT OR REPLACE INTO assets (id, userId, createdAt, updatedAt, isDeleted, encryptedData, encryptedDataIV)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				data.id,
				data.userId,
				data.createdAt,
				data.updatedAt,
				data.isDeleted,
				data.encryptedData,
				data.encryptedDataIV
			]
		);
		this.emitWriteEvent('assets', 'put', [record.id], options);
	}

	async softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();
		const now = Date.now();
		await db.execute(`UPDATE assets SET isDeleted = 1, updatedAt = $1 WHERE id = $2`, [now, id]);
		this.emitWriteEvent('assets', 'softDelete', [id], options);
	}

	async getAssetsSince(userId: string, sinceUpdatedAt: number): Promise<AssetRecord[]> {
		const db = await this.getDb();
		const rows = await db.select<AssetSqlRow[]>(
			`SELECT * FROM assets WHERE userId = $1 AND updatedAt > $2 ORDER BY updatedAt ASC`,
			[userId, sinceUpdatedAt]
		);
		return rows.map((row) => parseAssetRecord(row));
	}

	// ── Registry (assetRegistry table) ───────────────────────────────

	async getRegistry(id: string): Promise<AssetRegistryRecord | undefined> {
		const db = await this.getDb();
		const rows = await db.select<AssetRegistryRecord[]>(
			`SELECT * FROM assetRegistry WHERE id = $1`,
			[id]
		);
		if (rows.length > 0) {
			const row = rows[0] as unknown as { isDeleted: number };
			return {
				...rows[0],
				isDeleted: row.isDeleted === 1
			};
		}
		return undefined;
	}

	async getAllRegistry(userId: string, status?: AssetStatus): Promise<AssetRegistryRecord[]> {
		const db = await this.getDb();
		let rows: AssetRegistryRecord[];

		if (status) {
			rows = await db.select<AssetRegistryRecord[]>(
				`SELECT * FROM assetRegistry WHERE userId = $1 AND status = $2`,
				[userId, status]
			);
		} else {
			rows = await db.select<AssetRegistryRecord[]>(
				`SELECT * FROM assetRegistry WHERE userId = $1`,
				[userId]
			);
		}
		return rows.map((row) => {
			const r = row as unknown as { isDeleted: number };
			return {
				...row,
				isDeleted: r.isDeleted === 1
			};
		});
	}

	async putRegistry(
		id: string,
		userId: string,
		params: Partial<AssetRegistryParams>,
		options?: AssetWriteOptions
	): Promise<void> {
		const db = await this.getDb();
		const existing = await this.getRegistry(id);
		const now = Date.now();

		const record: AssetRegistryRecord = existing ?? {
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

		// Merge updates
		if (params.kind !== undefined) record.kind = params.kind;
		if (params.status !== undefined) record.status = params.status;
		if (params.lastAccessedAt !== undefined) record.lastAccessedAt = params.lastAccessedAt;
		if (params.size !== undefined) record.size = params.size;
		record.updatedAt = now;

		await db.execute(
			`INSERT OR REPLACE INTO assetRegistry (id, userId, createdAt, updatedAt, isDeleted, kind, status, lastAccessedAt, size)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				record.id,
				record.userId,
				record.createdAt,
				record.updatedAt,
				record.isDeleted ? 1 : 0,
				record.kind,
				record.status,
				record.lastAccessedAt,
				record.size
			]
		);
		this.emitWriteEvent('assetRegistry', 'put', [id], options);
	}

	async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();
		await db.execute(`DELETE FROM assetRegistry WHERE id = $1`, [id]);
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
		const db = await this.getDb();
		const [assetRows, registryRows] = await Promise.all([
			db.select<{ id: string }[]>(`SELECT id FROM assets WHERE userId = $1`, [userId]),
			db.select<{ id: string }[]>(`SELECT id FROM assetRegistry WHERE userId = $1`, [userId])
		]);

		const ids = new Set<string>([
			...assetRows.map((row) => row.id),
			...registryRows.map((row) => row.id)
		]);

		// Delete all blobs
		for (const id of ids) {
			await this.deleteBlob(id).catch(() => undefined);
		}

		// Delete DB records in transaction
		await db.execute('BEGIN TRANSACTION');
		try {
			await db.execute(`DELETE FROM assets WHERE userId = $1`, [userId]);
			await db.execute(`DELETE FROM assetRegistry WHERE userId = $1`, [userId]);
			await db.execute('COMMIT');
		} catch (error) {
			await db.execute('ROLLBACK');
			throw error;
		}
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
			await this.putRegistry(
				record.id,
				userId,
				{
					status: 'remote',
					kind: 'private', // Unknown here; will be corrected on first access
					size: 0
				},
				{ origin: 'sync' }
			);
		}

		return record;
	}
}

export const tauriAsset = new TauriAssetAdapter();
