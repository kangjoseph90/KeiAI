/**
 * Dexie-based Local Database Adapter (Web / PWA)
 *
 *   All encrypted tables share { id, [FK?], userId, …, data, iv }.
 *   Old v1/v2 tables (`characters`, `chats`) are dropped.
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
	SettingsRecord
} from './types.js';

class DexieStore extends Dexie {
	users!: Table<UserRecord, string>;
	characterSummaries!: Table<CharacterSummaryRecord, string>;
	characterData!: Table<CharacterDataRecord, string>;
	chatSummaries!: Table<ChatSummaryRecord, string>;
	chatData!: Table<ChatDataRecord, string>;
	messages!: Table<MessageRecord, string>;
	settings!: Table<SettingsRecord, string>;

	constructor() {
		super('KeiLocalDB');

		this.version(1).stores({
			users: 'id, userId, isGuest',
			characterSummaries: 'id, userId, updatedAt, isDeleted',
			characterData: 'id, userId, updatedAt, isDeleted',
			chatSummaries: 'id, userId, characterId, updatedAt, isDeleted',
			chatData: 'id, userId, updatedAt, isDeleted',
			messages: 'id, userId, chatId, updatedAt, isDeleted',
			settings: 'id, userId, updatedAt, isDeleted'
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
}

/** Global default adapter */
export const localDB: IDatabaseAdapter = new DexieDatabaseAdapter();
