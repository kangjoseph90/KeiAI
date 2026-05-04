/**
 * Dexie-based Local Database Adapter (Web / PWA)
 *
 * All tables store plaintext JSON in the `data` field.
 * Encryption happens only at the sync boundary (Sync Engine).
 */
import Dexie, { type Table } from 'dexie';
import type {
    IDatabaseAdapter,
    TableName,
    BaseRecord,
    DatabaseWriteEventListener,
    DatabaseWriteOptions,
    CharacterRecord,
    ChatRecord,
    MessageRecord,
    SettingsRecord,
    PersonaRecord,
    LorebookRecord,
    ScriptRecord,
    ModuleRecord,
    PluginRecord,
    PresetRecord,
    ToolCallRecord,
    TranslationRecord,
    CharJSRecord,
    DatabaseWriteOperation
} from './types';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';

class DexieStore extends Dexie {
    characters!: Table<CharacterRecord, string>;
    chats!: Table<ChatRecord, string>;
    presets!: Table<PresetRecord, string>;
    messages!: Table<MessageRecord, string>;
    settings!: Table<SettingsRecord, string>;
    personas!: Table<PersonaRecord, string>;
    lorebooks!: Table<LorebookRecord, string>;
    scripts!: Table<ScriptRecord, string>;
    modules!: Table<ModuleRecord, string>;
    plugins!: Table<PluginRecord, string>;
    tool_calls!: Table<ToolCallRecord, string>;
    translations!: Table<TranslationRecord, string>;
    charjs!: Table<CharJSRecord, string>;

    constructor() {
        super('KeiLocalDB');

        this.version(1).stores({
            characters: 'id, userId, updatedAt, isDeleted',
            chats: 'id, userId, characterId, updatedAt, isDeleted',
            presets: 'id, userId, updatedAt, isDeleted',
            messages: 'id, userId, chatId, [chatId+sortOrder], updatedAt, isDeleted',
            settings: 'id, userId, updatedAt, isDeleted',
            personas: 'id, userId, updatedAt, isDeleted',
            lorebooks: 'id, userId, ownerId, updatedAt, isDeleted',
            scripts: 'id, userId, ownerId, updatedAt, isDeleted',
            modules: 'id, userId, updatedAt, isDeleted',
            plugins: 'id, userId, updatedAt, isDeleted',
            tool_calls:
                'id, userId, chatId, messageId, swipeId, [messageId+swipeId], updatedAt, isDeleted',
            translations:
                'id, userId, chatId, messageId, swipeId, [messageId+swipeId], updatedAt, isDeleted',
            charjs: 'id, userId, ownerId, updatedAt, isDeleted'
        });
    }
}

export class WebDatabaseAdapter implements IDatabaseAdapter {
    private db: DexieStore;
    private readonly writeEvents = new DatabaseWriteEventEmitter();

    constructor() {
        this.db = new DexieStore();
    }

    subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    private getTable<T extends BaseRecord>(tableName: TableName): Table<T, string> {
        return this.db[tableName] as unknown as Table<T, string>;
    }

    async flush(): Promise<void> {
        return Promise.resolve();
    }

    async getRecord<T extends BaseRecord>(
        tableName: TableName,
        id: string
    ): Promise<T | undefined> {
        return await this.getTable<T>(tableName).get(id);
    }

    async putRecord<T extends BaseRecord>(
        tableName: TableName,
        record: T,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.getTable<T>(tableName).put(record);
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends BaseRecord>(
        tableName: TableName,
        records: T[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.getTable<T>(tableName).bulkPut(records);
        this.emitWriteEvent(
            tableName,
            'putMany',
            records.map((record) => record.id),
            options
        );
    }

    async deleteRecord(
        tableName: TableName,
        id: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
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
            record.updatedAt = clock.now();
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
        const now = clock.now();
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
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        return (await this.getTable<T>(tableName)
            .where(indexName)
            .between(lowerBound, upperBound, false, false) // Exclusive bounds
            .reverse()
            .filter((record: T) => !record.isDeleted)
            .offset(offset)
            .limit(limit) // Read in batches for generator
            .toArray()) as T[];
    }

    async getRecordsForward<T extends BaseRecord>(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        return (await this.getTable<T>(tableName)
            .where(indexName)
            .between(lowerBound, upperBound, false, false) // Exclusive bounds
            .filter((record: T) => !record.isDeleted)
            .offset(offset)
            .limit(limit)
            .toArray()) as T[];
    }

    async countRecordsInRange(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[]
    ): Promise<number> {
        await this.flush();
        return await this.getTable<BaseRecord>(tableName)
            .where(indexName)
            .between(lowerBound, upperBound, false, false)
            .filter((record) => !record.isDeleted)
            .count();
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
        return await this.db.transaction(mode, tables, callback);
    }

    async countByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string
    ): Promise<number> {
        await this.flush();
        return await this.getTable<BaseRecord>(tableName)
            .where(indexName)
            .equals(indexValue)
            .filter((record) => !record.isDeleted)
            .count();
    }

    private emitWriteEvent(
        tableName: TableName,
        operation: DatabaseWriteOperation,
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
