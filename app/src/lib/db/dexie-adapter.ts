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
	PersonaSummaryRecord,
	PersonaDataRecord,
	LorebookRecord,
	ScriptRecord,
	ModuleRecord,
	PluginRecord,
	PromptPresetSummaryRecord,
	PromptPresetDataRecord,
	AssetRecord
} from './types.js';

class DexieStore extends Dexie {
	users!: Table<UserRecord, string>;
	characterSummaries!: Table<CharacterSummaryRecord, string>;
	characterData!: Table<CharacterDataRecord, string>;
	chatSummaries!: Table<ChatSummaryRecord, string>;
	chatData!: Table<ChatDataRecord, string>;
	messages!: Table<MessageRecord, string>;
	settings!: Table<SettingsRecord, string>;
	personaSummaries!: Table<PersonaSummaryRecord, string>;
	personaData!: Table<PersonaDataRecord, string>;
	lorebooks!: Table<LorebookRecord, string>;
	scripts!: Table<ScriptRecord, string>;
	modules!: Table<ModuleRecord, string>;
	plugins!: Table<PluginRecord, string>;
	promptPresetSummaries!: Table<PromptPresetSummaryRecord, string>;
	promptPresetData!: Table<PromptPresetDataRecord, string>;
	assets!: Table<AssetRecord, string>;

	constructor() {
		super('KeiLocalDB');

		this.version(4).stores({
			// Encrypted tables (blind sync targets)
			users: 'id, userId, isGuest',
			characterSummaries: 'id, userId, updatedAt, isDeleted',
			characterData: 'id, userId, updatedAt, isDeleted',
			chatSummaries: 'id, userId, characterId, updatedAt, isDeleted',
			chatData: 'id, userId, characterId, updatedAt, isDeleted',
			messages: 'id, userId, chatId, updatedAt, isDeleted',
			settings: 'id, userId, updatedAt, isDeleted',
			personaSummaries: 'id, userId, updatedAt, isDeleted',
			personaData: 'id, userId, updatedAt, isDeleted',
			lorebooks: 'id, userId, ownerId, updatedAt, isDeleted',
			scripts: 'id, userId, ownerId, updatedAt, isDeleted',
			modules: 'id, userId, updatedAt, isDeleted',
			plugins: 'id, userId, updatedAt, isDeleted',
			promptPresetSummaries: 'id, userId, updatedAt, isDeleted',
			promptPresetData: 'id, userId, updatedAt, isDeleted',

			// Asset table (plaintext, no sync)
			assets: 'id, userId, kind, visibility, mimeType, createdAt'
		});
	}
}

export class DexieDatabaseAdapter implements IDatabaseAdapter {
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
		return await this.db.transaction(mode as unknown as any, tables, callback);
	}

	// ─── Asset-specific methods (not part of IDatabaseAdapter) ────────

	async putAsset(record: AssetRecord): Promise<void> {
		await this.db.assets.put(record);
	}

	async getAsset(id: string): Promise<AssetRecord | undefined> {
		return await this.db.assets.get(id);
	}

	async deleteAsset(id: string): Promise<void> {
		await this.db.assets.delete(id);
	}

	async getAssetsByUser(userId: string, kind?: 'regular' | 'inlay'): Promise<AssetRecord[]> {
		const collection = this.db.assets.where('userId').equals(userId);
		if (kind) {
			return await collection.filter((r) => r.kind === kind).toArray();
		}
		return await collection.toArray();
	}
}

/** Global default adapter */
export const localDB = new DexieDatabaseAdapter();
