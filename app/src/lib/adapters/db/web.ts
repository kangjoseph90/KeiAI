/**
 * Dexie-based Local Database Adapter (Web / PWA)
 *
 *   All encrypted tables share { id, [FK?], userId, …, data, iv }.
 *   Assets table is separate (plaintext, no encryption).
 */
import Dexie, { type Table } from 'dexie';
import type {
	IDatabaseAdapter,
	TableName,
	BaseRecord,
	DatabaseWriteEventListener,
	DatabaseWriteOptions,
	CharacterSummaryRecord,
	CharacterDataRecord,
	ChatSummaryRecord,
	ChatDataRecord,
	MessageRecord,
	SettingsRecord,
	PersonaRecord,
	LorebookRecord,
	ScriptRecord,
	ModuleRecord,
	PluginRecord,
	PresetSummaryRecord,
	PresetDataRecord
} from './types';
import { DB_DEBOUNCE_MS } from './types';
import { DatabaseWriteEventEmitter } from './events';

class DexieStore extends Dexie {
	characterSummaries!: Table<CharacterSummaryRecord, string>;
	characterData!: Table<CharacterDataRecord, string>;
	chatSummaries!: Table<ChatSummaryRecord, string>;
	chatData!: Table<ChatDataRecord, string>;
	messages!: Table<MessageRecord, string>;
	settings!: Table<SettingsRecord, string>;
	personas!: Table<PersonaRecord, string>;
	lorebooks!: Table<LorebookRecord, string>;
	scripts!: Table<ScriptRecord, string>;
	modules!: Table<ModuleRecord, string>;
	plugins!: Table<PluginRecord, string>;
	presetSummaries!: Table<PresetSummaryRecord, string>;
	presetData!: Table<PresetDataRecord, string>;

	constructor() {
		super('KeiLocalDB');

		this.version(6).stores({
			// Encrypted tables (Blind Sync targets)
			characterSummaries: 'id, userId, updatedAt, isDeleted',
			characterData: 'id, userId, updatedAt, isDeleted',
			chatSummaries: 'id, userId, characterId, updatedAt, isDeleted',
			chatData: 'id, userId, characterId, updatedAt, isDeleted',
			messages: 'id, userId, chatId, [chatId+sortOrder], updatedAt, isDeleted',
			settings: 'id, userId, updatedAt, isDeleted',
			personas: 'id, userId, updatedAt, isDeleted',
			lorebooks: 'id, userId, ownerId, updatedAt, isDeleted',
			scripts: 'id, userId, ownerId, updatedAt, isDeleted',
			modules: 'id, userId, updatedAt, isDeleted',
			plugins: 'id, userId, updatedAt, isDeleted',
			presetSummaries: 'id, userId, updatedAt, isDeleted',
			presetData: 'id, userId, updatedAt, isDeleted'
		});
	}
}

export class WebDatabaseAdapter implements IDatabaseAdapter {
	private db: DexieStore;
	private readonly writeEvents = new DatabaseWriteEventEmitter();

	private pendingWrites = new Map<
		string,
		{
			tableName: TableName;
			record: BaseRecord;
			options?: DatabaseWriteOptions;
		}
	>();
	private flushPromise: Promise<void> | null = null;
	private flushTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		this.db = new DexieStore();
	}

	subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void {
		return this.writeEvents.subscribe(listener);
	}

	private getTable<T extends BaseRecord>(tableName: TableName): Table<T, string> {
		return this.db[tableName] as unknown as Table<T, string>;
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
				console.error('[WebDatabaseAdapter] Delayed flush failed', err);
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

			const opsByTable = new Map<
				TableName,
				{ records: BaseRecord[]; options?: DatabaseWriteOptions }
			>();
			for (const pending of snapshot.values()) {
				if (!opsByTable.has(pending.tableName)) {
					opsByTable.set(pending.tableName, { records: [] });
				}
				const group = opsByTable.get(pending.tableName)!;
				group.records.push(pending.record);
				if (pending.options) group.options = pending.options;
			}

			try {
				await Dexie.ignoreTransaction(async () => {
					await this.transaction(Array.from(opsByTable.keys()), 'rw', async () => {
						for (const [tableName, group] of opsByTable.entries()) {
							const table = this.getTable<BaseRecord>(tableName);
							await table.bulkPut(group.records);
						}
					});
				});

				for (const [tableName, group] of opsByTable.entries()) {
					this.emitWriteEvent(
						tableName,
						group.records.length === 1 ? 'put' : 'putMany',
						group.records.map((r) => r.id),
						group.options
					);
				}
			} catch (err) {
				console.error('[WebDatabaseAdapter] Background flush failed', err);
				// Restore records that weren't overwritten in the meantime
				for (const [key, val] of snapshot) {
					if (!this.pendingWrites.has(key)) {
						this.pendingWrites.set(key, val);
					}
				}
				throw err;
			}
		})();

		try {
			await this.flushPromise;
		} finally {
			this.flushPromise = null;
		}
	}

	async getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined> {
		const cacheKey = this.getCacheKey(tableName, id);
		const pending = this.pendingWrites.get(cacheKey);
		if (pending) {
			return structuredClone(pending.record) as T;
		}
		return await this.getTable<T>(tableName).get(id);
	}

	async putRecord<T extends BaseRecord>(
		tableName: TableName,
		record: T,
		options?: DatabaseWriteOptions
	): Promise<void> {
		const cacheKey = this.getCacheKey(tableName, record.id);

		// If we are inside an active transaction (Dexie-managed or forced immediate),
		// we MUST bypass the buffer to ensure transaction atomicity and native locking.
		if (options?.immediate || Dexie.currentTransaction) {
			this.pendingWrites.delete(cacheKey);
			await this.getTable<T>(tableName).put(record);
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
		if (options?.immediate || Dexie.currentTransaction) {
			for (const rec of records) {
				this.pendingWrites.delete(this.getCacheKey(tableName, rec.id));
			}
			await this.getTable<T>(tableName).bulkPut(records);
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

		// If we are inside an active transaction (Dexie-managed or forced immediate),
		// we MUST bypass the buffer to ensure transaction atomicity and native locking.
		if (options?.immediate || Dexie.currentTransaction) {
			this.pendingWrites.delete(cacheKey);
			await this.getTable<BaseRecord>(tableName).delete(id);
			this.emitWriteEvent(tableName, 'delete', [id], options);
			return;
		}

		this.pendingWrites.delete(cacheKey);
		await this.getTable<BaseRecord>(tableName).delete(id);
		this.emitWriteEvent(tableName, 'delete', [id], options);
	}

	async deleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		options?: DatabaseWriteOptions
	): Promise<void> {
		await this.flush();
		const table = this.getTable<BaseRecord>(tableName);
		const ids = (
			(await table.where(indexName).equals(indexValue).primaryKeys()) as string[]
		).filter((id): id is string => typeof id === 'string');
		await table.where(indexName).equals(indexValue).delete();
		this.emitWriteEvent(tableName, 'deleteByIndex', ids, options);
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
		const table = this.getTable<BaseRecord>(tableName);
		const now = Date.now();
		const records = await table.where(indexName).equals(indexValue).toArray();
		for (const record of records) {
			record.isDeleted = true;
			record.updatedAt = now;
		}
		await table.bulkPut(records);
		this.emitWriteEvent(
			tableName,
			'softDeleteByIndex',
			records.map((record) => record.id),
			options
		);
	}

	async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
		await this.flush();
		return (await this.getTable<T>(tableName)
			.where('userId')
			.equals(userId)
			.filter((record: T) => !record.isDeleted)
			.sortBy('updatedAt')
			.then((results) => results.reverse())) as T[];
	}

	async getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit: number = 50,
		offset: number = 0
	): Promise<T[]> {
		await this.flush();
		return (await this.getTable<T>(tableName)
			.where(indexName)
			.equals(indexValue)
			.filter((record: T) => !record.isDeleted)
			.offset(offset)
			.limit(limit)
			.toArray()) as T[];
	}

	async getRecordsBackward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[], // e.g. [chatId, 0]
		upperBound: unknown[], // e.g. [chatId, cursorTime]
		limit: number = 50
	): Promise<T[]> {
		await this.flush();
		return (await this.getTable<T>(tableName)
			.where(indexName)
			.between(lowerBound, upperBound, false, false) // Exclusive bounds
			.reverse()
			.filter((record: T) => !record.isDeleted)
			.limit(limit) // Read in batches for generator
			.toArray()) as T[];
	}

	async getRecordsForward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit: number = 50
	): Promise<T[]> {
		await this.flush();
		return (await this.getTable<T>(tableName)
			.where(indexName)
			.between(lowerBound, upperBound, false, false) // Exclusive bounds
			.filter((record: T) => !record.isDeleted)
			.limit(limit)
			.toArray()) as T[];
	}

	async getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]> {
		await this.flush();
		return (await this.getTable<T>(tableName)
			.where('userId')
			.equals(userId)
			.filter((record: T) => (record.updatedAt ?? 0) >= sinceUpdatedAt)
			.toArray()) as T[];
	}

	async transaction<R>(
		tables: TableName[],
		mode: 'r' | 'rw',
		callback: () => Promise<R>
	): Promise<R> {
		await this.flush();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await this.db.transaction(mode as unknown as any, tables, callback);
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
