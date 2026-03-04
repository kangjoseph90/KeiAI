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
	UserRecord,
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
	PresetDataRecord,
	AssetRecord,
	CacheRegistryRecord,
} from './types.js';

class DexieStore extends Dexie {
	users!: Table<UserRecord, string>;
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
	assets!: Table<AssetRecord, string>;
	cacheRegistry!: Table<CacheRegistryRecord, string>;

	constructor() {
		super('KeiLocalDB');

		this.version(6).stores({
			// Encrypted tables (Blind Sync targets)
			users: 'id, userId, isGuest',
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
			presetData: 'id, userId, updatedAt, isDeleted',
			assets: 'id, userId, updatedAt, isDeleted',
			// Local-only tables (never synced)
			cacheRegistry: 'id, lastAccessedAt',
		});
	}
}

export class WebDatabaseAdapter implements IDatabaseAdapter {
	private db: DexieStore;

	constructor() {
		this.db = new DexieStore();
	}

	private getTable<T extends BaseRecord>(tableName: TableName): Table<T, string> {
		return this.db[tableName] as unknown as Table<T, string>;
	}

	async getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined> {
		return await this.getTable<T>(tableName).get(id);
	}

	async putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void> {
		await this.getTable<T>(tableName).put(record);
	}

	async putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void> {
		const now = Date.now();
		for (const record of records) {
			if (!record.updatedAt) {
				record.updatedAt = now;
			}
		}
		await this.getTable<T>(tableName).bulkPut(records);
	}

	async deleteRecord(tableName: TableName, id: string): Promise<void> {
		await this.getTable<BaseRecord>(tableName).delete(id);
	}

	async softDeleteRecord(tableName: TableName, id: string): Promise<void> {
		const table = this.getTable<BaseRecord>(tableName);
		const record = await table.get(id);
		if (record) {
			record.isDeleted = true;
			record.updatedAt = Date.now();
			await table.put(record);
		}
	}

	async softDeleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string
	): Promise<void> {
		const table = this.getTable<BaseRecord>(tableName);
		const now = Date.now();
		const records = await table.where(indexName).equals(indexValue).toArray();
		for (const record of records) {
			record.isDeleted = true;
			record.updatedAt = now;
		}
		await table.bulkPut(records);
	}

	async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
		return (await this.getTable<T>(tableName)
			.where('userId')
			.equals(userId)
			.filter((record: T) => !record.isDeleted)
			.sortBy('updatedAt')) as T[];
	}

	async getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit: number = 50,
		offset: number = 0
	): Promise<T[]> {
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
		return (await this.getTable<T>(tableName)
			.where('userId')
			.equals(userId)
			.filter((record: T) => (record.updatedAt ?? 0) > sinceUpdatedAt)
			.toArray()) as T[];
	}

	async transaction<R>(
		tables: TableName[],
		mode: 'r' | 'rw',
		callback: () => Promise<R>
	): Promise<R> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await this.db.transaction(mode as unknown as any, tables, callback);
	}
}

/** Global default adapter */
export const localDB = new WebDatabaseAdapter();
