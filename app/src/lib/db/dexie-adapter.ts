/**
 * Dexie-based Local Database Adapter (for Web/PWA)
 */
import Dexie, { type Table } from 'dexie';
import type {
	IDatabaseAdapter,
	TableName,
	BaseRecord,
	UserRecord,
	CharacterRecord,
	ChatRecord,
	MessageRecord,
	SettingsRecord
} from './types.js';

class DexieStore extends Dexie {
	users!: Table<UserRecord, string>;
	characters!: Table<CharacterRecord, string>;
	chats!: Table<ChatRecord, string>;
	messages!: Table<MessageRecord, string>;
	settings!: Table<SettingsRecord, string>;

	constructor() {
		super('KeiLocalDB');

		// Indexed fields for where() clauses. 
		// First item is Primary Key.
		// Encrypted Uint8Array fields are NOT indexed.
		this.version(1).stores({
			users: 'id, isGuest',
			characters: 'id, userId, updatedAt, isDeleted',
			chats: 'id, userId, characterId, updatedAt, isDeleted',
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

	private getTable(tableName: TableName): Table<any, string> {
		return this.db[tableName] as any;
	}

	async getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined> {
		return await this.getTable(tableName).get(id);
	}

	async putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void> {
		record.updatedAt = Date.now();
		await this.getTable(tableName).put(record);
	}

	async putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void> {
		const now = Date.now();
		for (const record of records) {
			if (!record.updatedAt) {
				record.updatedAt = now;
			}
		}
		await this.getTable(tableName).bulkPut(records);
	}

	async softDeleteRecord(tableName: TableName, id: string): Promise<void> {
		const table = this.getTable(tableName);
		const record = await table.get(id);
		if (record) {
			record.isDeleted = true;
			record.updatedAt = Date.now();
			await table.put(record);
		}
	}

	async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
		return (await this.getTable(tableName)
			.where('userId')
			.equals(userId)
			.filter((record) => !record.isDeleted)
			.sortBy('updatedAt')) as T[];
	}

	async getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit: number = 50,
		offset: number = 0
	): Promise<T[]> {
		return (await this.getTable(tableName)
			.where(indexName)
			.equals(indexValue)
			.filter((record) => !record.isDeleted)
			.offset(offset)
			.limit(limit)
			.toArray()) as T[];
	}

	async getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]> {
		return (await this.getTable(tableName)
			.where('userId')
			.equals(userId)
			.filter((record) => record.updatedAt > sinceUpdatedAt)
			.toArray()) as T[];
	}
}

// Global default adapter (currently hardcoded to Dexie for Web)
export const localDB: IDatabaseAdapter = new DexieDatabaseAdapter();
