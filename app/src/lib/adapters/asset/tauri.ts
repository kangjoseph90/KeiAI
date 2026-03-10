import Database from '@tauri-apps/plugin-sql';
import { fromBase64, toBase64 } from '$lib/crypto/encoding';
import { AssetWriteEventEmitter } from './events';
import type {
	IAssetAdapter,
	AssetRecord,
	AssetRegistryRecord,
	AssetWriteEventListener,
	AssetWriteOptions,
	AssetTableName,
	AssetWriteOperation
} from './types';

/**
 * Tauri Asset Adapter
 *
 * SQLite storage for asset metadata (assets, assetRegistry tables).
 * Binary blobs are stored via appStorage (native FS) directly by the service layer.
 *
 * Row structure:
 *   - assets: encrypted metadata record (EncryptedRecord)
 *   - assetRegistry: plaintext cache of asset fields per device
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

/** Raw shape of a registry record as stored in SQLite */
interface RegistrySqlRow {
	id: string;
	userId: string;
	createdAt: number;
	updatedAt: number;
	isDeleted: number;
	kind: string;
	status: string;
	hash: string;
	encKey: string;
	size: number;
	accessedAt: number;
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

/** Parse raw SQLite row into AssetRegistryRecord */
function parseRegistryRecord(row: RegistrySqlRow): AssetRegistryRecord {
	return {
		id: row.id,
		userId: row.userId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		isDeleted: row.isDeleted === 1,
		kind: row.kind as AssetRegistryRecord['kind'],
		status: row.status as AssetRegistryRecord['status'],
		hash: row.hash,
		encKey: row.encKey,
		size: row.size,
		accessedAt: row.accessedAt
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

		// Asset registry table - plaintext cache + delete queue
		await db.execute(`
			CREATE TABLE IF NOT EXISTS assetRegistry (
				id TEXT PRIMARY KEY,
				userId TEXT NOT NULL,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL,
				isDeleted INTEGER NOT NULL DEFAULT 0,
				kind TEXT NOT NULL,
				status TEXT NOT NULL,
				hash TEXT NOT NULL DEFAULT '',
				encKey TEXT NOT NULL DEFAULT '',
				size INTEGER NOT NULL DEFAULT 0,
				accessedAt INTEGER NOT NULL
			)
		`);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_userId ON assetRegistry (userId)`
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_userId_status ON assetRegistry (userId, status)`
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_userId_isDeleted ON assetRegistry (userId, isDeleted)`
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_assetRegistry_accessedAt ON assetRegistry (accessedAt)`
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
		const rows = await db.select<RegistrySqlRow[]>(`SELECT * FROM assetRegistry WHERE id = $1`, [
			id
		]);
		if (rows.length > 0) return parseRegistryRecord(rows[0]);
		return undefined;
	}

	async getAllRegistry(userId: string): Promise<AssetRegistryRecord[]> {
		const db = await this.getDb();
		const rows = await db.select<RegistrySqlRow[]>(
			`SELECT * FROM assetRegistry WHERE userId = $1 AND isDeleted = 0`,
			[userId]
		);
		return rows.map((row) => parseRegistryRecord(row));
	}

	async getDeletedRegistry(userId: string): Promise<AssetRegistryRecord[]> {
		const db = await this.getDb();
		const rows = await db.select<RegistrySqlRow[]>(
			`SELECT * FROM assetRegistry WHERE userId = $1 AND isDeleted = 1`,
			[userId]
		);
		return rows.map((row) => parseRegistryRecord(row));
	}

	async putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();

		await db.execute(
			`INSERT OR REPLACE INTO assetRegistry (id, userId, createdAt, updatedAt, isDeleted, kind, status, hash, encKey, size, accessedAt)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			[
				record.id,
				record.userId,
				record.createdAt,
				record.updatedAt,
				record.isDeleted ? 1 : 0,
				record.kind,
				record.status,
				record.hash,
				record.encKey,
				record.size,
				record.accessedAt
			]
		);
		this.emitWriteEvent('assetRegistry', 'put', [record.id], options);
	}

	async softDeleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();
		const now = Date.now();
		await db.execute(`UPDATE assetRegistry SET isDeleted = 1, updatedAt = $1 WHERE id = $2`, [
			now,
			id
		]);
		this.emitWriteEvent('assetRegistry', 'softDelete', [id], options);
	}

	async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
		const db = await this.getDb();
		await db.execute(`DELETE FROM assetRegistry WHERE id = $1`, [id]);
		this.emitWriteEvent('assetRegistry', 'delete', [id], options);
	}
}

export const tauriAsset = new TauriAssetAdapter();
