import Database from '@tauri-apps/plugin-sql';
import type { IDatabaseAdapter, TableName, BaseRecord } from './types.js';
import { TABLES } from './types.js';

/**
 * Tauri SQLite Local Database Adapter
 *
 * Uses @tauri-apps/plugin-sql.
 * Creates a unified row structure for all tables containing:
 *  - Primary `id`
 *  - Commonly indexed string/number columns
 *  - `data` column: JSON.stringified raw object payload
 *
 * `Uint8Array` properties are temporarily converted to base64 strings
 * during JSON.stringify to survive SQLite TEXT column storage, and converted
 * back upon reading.
 */


function arrayBufferToBase64(buffer: ArrayBufferLike): string {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
	const binaryString = atob(base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

// Convert record to DB row bindings safely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recordToBindings(record: any) {
	const clone = { ...record };

	const bindings = {
		id: clone.id ?? null,
		userId: clone.userId ?? null,
		characterId: clone.characterId ?? null,
		chatId: clone.chatId ?? null,
		sortOrder: clone.sortOrder ?? null,
		ownerId: clone.ownerId ?? null,
		lastAccessedAt: clone.lastAccessedAt ?? null,
		updatedAt: clone.updatedAt ?? null,
		isDeleted: clone.isDeleted ? 1 : 0
	};

	if (clone.encryptedData instanceof Uint8Array) {
		clone.encryptedData = arrayBufferToBase64(clone.encryptedData);
	}
	if (clone.encryptedDataIV instanceof Uint8Array) {
		clone.encryptedDataIV = arrayBufferToBase64(clone.encryptedDataIV);
	}

	return {
		...bindings,
		data: JSON.stringify(clone)
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRecord<T>(row: any): T {
	const obj = JSON.parse(row.data);
	if (typeof obj.encryptedData === 'string') {
		obj.encryptedData = base64ToArrayBuffer(obj.encryptedData);
	}
	if (typeof obj.encryptedDataIV === 'string') {
		obj.encryptedDataIV = base64ToArrayBuffer(obj.encryptedDataIV);
	}
	return obj as T;
}

export class TauriDatabaseAdapter implements IDatabaseAdapter {
	private dbPromise: Promise<Database> | null = null;

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
		for (const table of TABLES) {
			await db.execute(`
				CREATE TABLE IF NOT EXISTS ${table} (
					id TEXT PRIMARY KEY,
					userId TEXT,
					characterId TEXT,
					chatId TEXT,
					sortOrder TEXT,
					ownerId TEXT,
					lastAccessedAt INTEGER,
					updatedAt INTEGER,
					isDeleted INTEGER,
					data TEXT
				)
			`);

			// Common indices used securely for lookup and sync
			await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_userId ON ${table} (userId)`);
			await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_updatedAt ON ${table} (updatedAt)`);
		}

		// Additional compound index strictly required for pagination performance in messages
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_messages_chatId_sortOrder ON messages (chatId, sortOrder)`
		);
	}

	async getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined> {
		const db = await this.getDb();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(`SELECT data FROM ${tableName} WHERE id = $1`, [id]);
		if (rows.length > 0) return parseRecord<T>(rows[0]);
		return undefined;
	}

	async putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void> {
		const db = await this.getDb();
		const now = Date.now();
		if (!record.updatedAt && tableName !== 'cacheRegistry') {
			record.updatedAt = now;
		}

		const b = recordToBindings(record);
		await db.execute(
			`INSERT OR REPLACE INTO ${tableName} 
            (id, userId, characterId, chatId, sortOrder, ownerId, lastAccessedAt, updatedAt, isDeleted, data) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			[
				b.id,
				b.userId,
				b.characterId,
				b.chatId,
				b.sortOrder,
				b.ownerId,
				b.lastAccessedAt,
				b.updatedAt,
				b.isDeleted,
				b.data
			]
		);
	}

	async putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void> {
		const db = await this.getDb();
		const now = Date.now();

		const chunkSize = 50;

		for (let i = 0; i < records.length; i += chunkSize) {
			const chunk = records.slice(i, i + chunkSize);
			const placeholders = chunk
				.map((_, idx) => {
					const start = idx * 10 + 1;
					return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9})`;
				})
				.join(', ');

			const values: unknown[] = [];
			for (const record of chunk) {
				if (!record.updatedAt && tableName !== 'cacheRegistry') {
					record.updatedAt = now;
				}
				const b = recordToBindings(record);
				values.push(
					b.id,
					b.userId,
					b.characterId,
					b.chatId,
					b.sortOrder,
					b.ownerId,
					b.lastAccessedAt,
					b.updatedAt,
					b.isDeleted,
					b.data
				);
			}

			await db.execute(
				`INSERT OR REPLACE INTO ${tableName} 
                (id, userId, characterId, chatId, sortOrder, ownerId, lastAccessedAt, updatedAt, isDeleted, data) 
                VALUES ${placeholders}`,
				values
			);
		}
	}

	async deleteRecord(tableName: TableName, id: string): Promise<void> {
		const db = await this.getDb();
		await db.execute(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
	}

	async deleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string
	): Promise<void> {
		const db = await this.getDb();
		await db.execute(`DELETE FROM ${tableName} WHERE ${indexName} = $1`, [indexValue]);
	}

	async softDeleteRecord(tableName: TableName, id: string): Promise<void> {
		const db = await this.getDb();
		const now = Date.now();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(`SELECT data FROM ${tableName} WHERE id = $1`, [id]);
		if (rows.length > 0) {
			const record = parseRecord<BaseRecord>(rows[0]);
			record.isDeleted = true;
			record.updatedAt = now;
			await this.putRecord(tableName, record);
		}
	}

	async softDeleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string
	): Promise<void> {
		const db = await this.getDb();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(
			`SELECT data FROM ${tableName} WHERE ${indexName} = $1`,
			[indexValue]
		);
		const now = Date.now();
		const recordsToUpdate: BaseRecord[] = [];

		for (const row of rows) {
			const record = parseRecord<BaseRecord>(row);
			record.isDeleted = true;
			record.updatedAt = now;
			recordsToUpdate.push(record);
		}

		if (recordsToUpdate.length > 0) {
			await this.putRecords(tableName, recordsToUpdate);
		}
	}

	async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
		const db = await this.getDb();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(
			`SELECT data FROM ${tableName} WHERE userId = $1 AND isDeleted = 0 ORDER BY updatedAt ASC`,
			[userId]
		);
		return rows.map((row) => parseRecord<T>(row));
	}

	async getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit: number = 50,
		offset: number = 0
	): Promise<T[]> {
		const db = await this.getDb();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(
			`SELECT data FROM ${tableName} WHERE ${indexName} = $1 AND isDeleted = 0 LIMIT $2 OFFSET $3`,
			[indexValue, limit, offset]
		);
		return rows.map((row) => parseRecord<T>(row));
	}

	async getRecordsBackward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit: number = 50
	): Promise<T[]> {
		const db = await this.getDb();

		const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
		if (isComposite) {
			const cols = indexName.slice(1, -1).split('+');
			if (cols.length === 2) {
				const col1 = cols[0];
				const col2 = cols[1];

				const val1 = lowerBound[0];
				const lower2 = lowerBound[1];
				const upper2 = upperBound[1];

				const query = `SELECT data FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} DESC LIMIT $4`;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const rows = await db.select<any[]>(query, [val1, lower2, upper2, limit]);
				return rows.map((row) => parseRecord<T>(row));
			}
		}

		throw new Error(`TauriDatabaseAdapter: getRecordsBackward unsupported indexName ${indexName}`);
	}

	async getRecordsForward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit: number = 50
	): Promise<T[]> {
		const db = await this.getDb();

		const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
		if (isComposite) {
			const cols = indexName.slice(1, -1).split('+');
			if (cols.length === 2) {
				const col1 = cols[0];
				const col2 = cols[1];

				const val1 = lowerBound[0];
				const lower2 = lowerBound[1];
				const upper2 = upperBound[1];

				const query = `SELECT data FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} ASC LIMIT $4`;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const rows = await db.select<any[]>(query, [val1, lower2, upper2, limit]);
				return rows.map((row) => parseRecord<T>(row));
			}
		}

		throw new Error(`TauriDatabaseAdapter: getRecordsForward unsupported indexName ${indexName}`);
	}

	async getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]> {
		const db = await this.getDb();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows = await db.select<any[]>(
			`SELECT data FROM ${tableName} WHERE userId = $1 AND updatedAt > $2`,
			[userId, sinceUpdatedAt]
		);
		return rows.map((row) => parseRecord<T>(row));
	}

	async transaction<R>(
		_tables: TableName[],
		_mode: 'r' | 'rw',
		callback: () => Promise<R>
	): Promise<R> {
		const db = await this.getDb();
		await db.execute('BEGIN TRANSACTION');
		try {
			const result = await callback();
			await db.execute('COMMIT');
			return result;
		} catch (error) {
			await db.execute('ROLLBACK');
			throw error;
		}
	}
}
