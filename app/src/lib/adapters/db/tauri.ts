import Database from '@tauri-apps/plugin-sql';
import { fromBase64, toBase64 } from '$lib/crypto/encoding';
import type {
	IDatabaseAdapter,
	TableName,
	BaseRecord,
	DatabaseWriteEventListener,
	DatabaseWriteOptions
} from './types';
import { TABLES, DB_DEBOUNCE_MS } from './types';
import { AppError } from '$lib/shared/errors';
import { DatabaseWriteEventEmitter } from './events';

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

/** Raw shape of a database record as stored in SQLite */
interface DatabaseSqlRow {
	id: string;
	userId: string | null;
	characterId: string | null;
	chatId: string | null;
	sortOrder: string | null;
	ownerId: string | null;
	updatedAt: number | null;
	isDeleted: number; // 0 | 1
	data: string; // JSON.stringify(...)
}

// Convert record to DB row bindings safely
function recordToBindings<T extends BaseRecord>(record: T): DatabaseSqlRow {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const clone = { ...record } as any;

	const bindings: DatabaseSqlRow = {
		id: clone.id,
		userId: clone.userId ?? null,
		characterId: (clone as { characterId?: string }).characterId ?? null,
		chatId: (clone as { chatId?: string }).chatId ?? null,
		sortOrder: (clone as { sortOrder?: string }).sortOrder ?? null,
		ownerId: (clone as { ownerId?: string }).ownerId ?? null,
		updatedAt: clone.updatedAt ?? null,
		isDeleted: clone.isDeleted ? 1 : 0,
		data: '' // placeholder
	};

	if (clone.encryptedData instanceof Uint8Array) {
		clone.encryptedData = toBase64(clone.encryptedData);
	}
	if (clone.encryptedDataIV instanceof Uint8Array) {
		clone.encryptedDataIV = toBase64(clone.encryptedDataIV);
	}

	bindings.data = JSON.stringify(clone);
	return bindings;
}

function parseRecord<T>(row: DatabaseSqlRow): T {
	const obj = JSON.parse(row.data);
	if (typeof obj.encryptedData === 'string') {
		obj.encryptedData = fromBase64(obj.encryptedData);
	}
	if (typeof obj.encryptedDataIV === 'string') {
		obj.encryptedDataIV = fromBase64(obj.encryptedDataIV);
	}
	return obj as T;
}

export class TauriDatabaseAdapter implements IDatabaseAdapter {
	private dbPromise: Promise<Database> | null = null;
	private readonly writeEvents = new DatabaseWriteEventEmitter();

	private pendingWrites = new Map<
		string,
		{
			tableName: TableName;
			record: BaseRecord;
			options?: DatabaseWriteOptions;
		}
	>();
	private inTransaction = false;
	private flushPromise: Promise<void> | null = null;
	private flushTimeout: ReturnType<typeof setTimeout> | null = null;

	subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void {
		return this.writeEvents.subscribe(listener);
	}

	private getCacheKey(tableName: TableName, id: string): string {
		return `${tableName}:${id}`;
	}

	private scheduleFlush() {
		if (this.flushTimeout) {
			clearTimeout(this.flushTimeout);
		}
		this.flushTimeout = setTimeout(() => {
			this.flush().catch((err) => {
				console.error('[TauriDatabaseAdapter] Delayed flush failed', err);
			});
		}, DB_DEBOUNCE_MS);
	}

	async flush(): Promise<void> {
		if (this.flushPromise) return this.flushPromise;

		this.flushPromise = (async () => {
			if (this.flushTimeout) {
				clearTimeout(this.flushTimeout);
				this.flushTimeout = null;
			}

			if (this.pendingWrites.size === 0) return;

			const snapshot = new Map(this.pendingWrites);
			this.pendingWrites.clear();

			const recordsByTable = new Map<
				TableName,
				{ records: BaseRecord[]; options?: DatabaseWriteOptions }
			>();

			for (const pending of snapshot.values()) {
				if (!recordsByTable.has(pending.tableName)) {
					recordsByTable.set(pending.tableName, { records: [] });
				}
				const group = recordsByTable.get(pending.tableName)!;
				group.records.push(pending.record);
				if (pending.options) group.options = pending.options;
			}

			// Actual DB batch commit
			try {
				const db = await this.getDb();
				await db.execute('BEGIN TRANSACTION');

				for (const [tableName, group] of recordsByTable.entries()) {
					const chunkSize = 50;
					for (let i = 0; i < group.records.length; i += chunkSize) {
						const chunk = group.records.slice(i, i + chunkSize);
						const placeholders = chunk
							.map((_, idx) => {
								const start = idx * 9 + 1;
								return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
							})
							.join(', ');

						const values: unknown[] = [];
						for (const record of chunk) {
							const b = recordToBindings(record);
							values.push(
								b.id,
								b.userId,
								b.characterId,
								b.chatId,
								b.sortOrder,
								b.ownerId,
								b.updatedAt,
								b.isDeleted,
								b.data
							);
						}

						await db.execute(
							`INSERT OR REPLACE INTO ${tableName} 
						(id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data) 
						VALUES ${placeholders}`,
							values
						);
					}
				}

				await db.execute('COMMIT');

				// Emit events after successful commit
				for (const [tableName, group] of recordsByTable.entries()) {
					this.emitWriteEvent(
						tableName,
						group.records.length === 1 ? 'put' : 'putMany',
						group.records.map((r) => r.id),
						group.options
					);
				}
			} catch (error) {
				// Try to rollback
				const rollbackDb = await this.getDb();
				rollbackDb.execute('ROLLBACK').catch(() => {});
				console.error('[TauriDatabaseAdapter] Background flush failed', error);

				// Restore records that weren't overwritten in the meantime
				for (const [key, val] of snapshot) {
					if (!this.pendingWrites.has(key)) {
						this.pendingWrites.set(key, val);
					}
				}
				throw error;
			}
		})();

		try {
			await this.flushPromise;
		} finally {
			this.flushPromise = null;
		}
	}

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
					updatedAt INTEGER,
					isDeleted INTEGER,
					data TEXT
				)
			`);

			// Common indices used securely for lookup and sync
			await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_userId ON ${table} (userId)`);
			await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_updatedAt ON ${table} (updatedAt)`);
		}

		// FK indices for 1:N parent→child queries
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_chatSummaries_characterId ON chatSummaries (characterId)`
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_chatData_characterId ON chatData (characterId)`
		);
		await db.execute(`CREATE INDEX IF NOT EXISTS idx_lorebooks_ownerId ON lorebooks (ownerId)`);
		await db.execute(`CREATE INDEX IF NOT EXISTS idx_scripts_ownerId ON scripts (ownerId)`);

		// Compound index strictly required for pagination performance in messages
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_messages_chatId_sortOrder ON messages (chatId, sortOrder)`
		);
	}

	async getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined> {
		const cacheKey = this.getCacheKey(tableName, id);
		const pending = this.pendingWrites.get(cacheKey);
		if (pending) {
			return structuredClone(pending.record) as T;
		}

		const db = await this.getDb();
		const rows = await db.select<DatabaseSqlRow[]>(`SELECT data FROM ${tableName} WHERE id = $1`, [
			id
		]);
		if (rows.length > 0) return parseRecord<T>(rows[0]);
		return undefined;
	}

	async putRecord<T extends BaseRecord>(
		tableName: TableName,
		record: T,
		options?: DatabaseWriteOptions
	): Promise<void> {
		const cacheKey = this.getCacheKey(tableName, record.id);


		// During a transaction or for immediate writes, bypass the buffer to ensure
		// atomicity and let SQLite handle the native commit/rollback lifecycle.
		if (options?.immediate || this.inTransaction) {
			this.pendingWrites.delete(cacheKey);
			const db = await this.getDb();
			const b = recordToBindings(record);
			await db.execute(
				`INSERT OR REPLACE INTO ${tableName} 
				(id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data) 
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				[
					b.id,
					b.userId,
					b.characterId,
					b.chatId,
					b.sortOrder,
					b.ownerId,
					b.updatedAt,
					b.isDeleted,
					b.data
				]
			);
			this.emitWriteEvent(tableName, 'put', [record.id], options);
			return;
		}

		this.pendingWrites.set(cacheKey, {
			tableName,
			record: structuredClone(record) as BaseRecord,
			options
		});
		this.scheduleFlush();
	}

	async putRecords<T extends BaseRecord>(
		tableName: TableName,
		records: T[],
		options?: DatabaseWriteOptions
	): Promise<void> {
		// During a transaction or for immediate writes, bypass the buffer to ensure
		// atomicity and let SQLite handle the native commit/rollback lifecycle.
		if (options?.immediate || this.inTransaction) {
			for (const rec of records) {
				this.pendingWrites.delete(this.getCacheKey(tableName, rec.id));
			}

			const db = await this.getDb();
			const chunkSize = 50;

			for (let i = 0; i < records.length; i += chunkSize) {
				const chunk = records.slice(i, i + chunkSize);
				const placeholders = chunk
					.map((_, idx) => {
						const start = idx * 9 + 1;
						return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
					})
					.join(', ');

				const values: unknown[] = [];
				for (const record of chunk) {
					const b = recordToBindings(record);
					values.push(
						b.id,
						b.userId,
						b.characterId,
						b.chatId,
						b.sortOrder,
						b.ownerId,
						b.updatedAt,
						b.isDeleted,
						b.data
					);
				}

				await db.execute(
					`INSERT OR REPLACE INTO ${tableName} 
					(id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data) 
					VALUES ${placeholders}`,
					values
				);
			}

			this.emitWriteEvent(
				tableName,
				'putMany',
				records.map((record) => record.id),
				options
			);
			return;
		}

		for (const record of records) {
			const cacheKey = this.getCacheKey(tableName, record.id);
			this.pendingWrites.set(cacheKey, {
				tableName,
				record: structuredClone(record) as BaseRecord,
				options
			});
		}
		this.scheduleFlush();
	}

	async deleteRecord(
		tableName: TableName,
		id: string,
		options?: DatabaseWriteOptions
	): Promise<void> {
		const cacheKey = this.getCacheKey(tableName, id);
		this.pendingWrites.delete(cacheKey);

		// Note: delete is always immediate in Tauri since it's not a high-frequency operation
		// that benefits from debouncing, and it clears any pending writes for the same ID.
		const db = await this.getDb();
		await db.execute(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
		this.emitWriteEvent(tableName, 'delete', [id], options);
	}

	async deleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		options?: DatabaseWriteOptions
	): Promise<void> {
		await this.flush();
		const db = await this.getDb();
		const rows = await db.select<{ id: string }[]>(
			`SELECT id FROM ${tableName} WHERE ${indexName} = $1`,
			[indexValue]
		);
		await db.execute(`DELETE FROM ${tableName} WHERE ${indexName} = $1`, [indexValue]);
		this.emitWriteEvent(
			tableName,
			'deleteByIndex',
			rows.map((row) => row.id),
			options
		);
	}

	async softDeleteRecord(
		tableName: TableName,
		id: string,
		options?: DatabaseWriteOptions
	): Promise<void> {
		const record = await this.getRecord<BaseRecord>(tableName, id);

		if (record) {
			record.isDeleted = true;
			record.updatedAt = Date.now();
			await this.putRecord(tableName, record, options);
		}
	}

	async softDeleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		options?: DatabaseWriteOptions
	): Promise<void> {
		await this.flush();
		const db = await this.getDb();
		const rows = await db.select<DatabaseSqlRow[]>(
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
			const chunkSize = 50;
			for (let i = 0; i < recordsToUpdate.length; i += chunkSize) {
				const chunk = recordsToUpdate.slice(i, i + chunkSize);
				const placeholders = chunk
					.map((_, idx) => {
						const start = idx * 9 + 1;
						return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
					})
					.join(', ');
				const values: unknown[] = [];
				for (const record of chunk) {
					const b = recordToBindings(record);
					values.push(
						b.id,
						b.userId,
						b.characterId,
						b.chatId,
						b.sortOrder,
						b.ownerId,
						b.updatedAt,
						b.isDeleted,
						b.data
					);
				}
				await db.execute(
					`INSERT OR REPLACE INTO ${tableName}
                (id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data)
                VALUES ${placeholders}`,
					values
				);
			}
			this.emitWriteEvent(
				tableName,
				'softDeleteByIndex',
				recordsToUpdate.map((r) => r.id),
				options
			);
		}
	}

	async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
		await this.flush();
		const db = await this.getDb();
		const rows = await db.select<DatabaseSqlRow[]>(
			`SELECT data FROM ${tableName} WHERE userId = $1 AND isDeleted = 0 ORDER BY updatedAt DESC`,
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
		await this.flush();
		const db = await this.getDb();
		const rows = await db.select<DatabaseSqlRow[]>(
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
		await this.flush();
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
				const rows = await db.select<DatabaseSqlRow[]>(query, [val1, lower2, upper2, limit]);
				return rows.map((row) => parseRecord<T>(row));
			}
		}

		throw new AppError(
			'INVALID_INPUT',
			`Unsupported indexName for getRecordsBackward: ${indexName}`
		);
	}

	async getRecordsForward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit: number = 50
	): Promise<T[]> {
		await this.flush();
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
				const rows = await db.select<DatabaseSqlRow[]>(query, [val1, lower2, upper2, limit]);
				return rows.map((row) => parseRecord<T>(row));
			}
		}

		throw new AppError(
			'INVALID_INPUT',
			`Unsupported indexName for getRecordsForward: ${indexName}`
		);
	}

	async getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]> {
		await this.flush();
		const db = await this.getDb();
		const rows = await db.select<DatabaseSqlRow[]>(
			`SELECT data FROM ${tableName} WHERE userId = $1 AND updatedAt >= $2`,
			[userId, sinceUpdatedAt]
		);
		return rows.map((row) => parseRecord<T>(row));
	}

	async transaction<R>(
		_tables: TableName[],
		_mode: 'r' | 'rw',
		callback: () => Promise<R>
	): Promise<R> {
		await this.flush();
		const db = await this.getDb();
		this.inTransaction = true;
		await db.execute('BEGIN TRANSACTION');
		try {
			const result = await callback();
			await db.execute('COMMIT');
			return result;
		} catch (error) {
			await db.execute('ROLLBACK');
			throw error;
		} finally {
			this.inTransaction = false;
		}
	}

	private emitWriteEvent(
		tableName: TableName,
		operation: 'put' | 'putMany' | 'delete' | 'deleteByIndex' | 'softDelete' | 'softDeleteByIndex',
		ids: string[],
		options?: DatabaseWriteOptions
	): void {
		if (ids.length === 0) return;

		this.writeEvents.emit({
			tableName,
			operation,
			ids,
			origin: options?.origin ?? 'local'
		});
	}
}
