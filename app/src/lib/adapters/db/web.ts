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
    DataRecord,
    DataScope,
    DatabaseWriteEventListener,
    DatabaseWriteOptions,
    CharacterRecord,
    ChatRecord,
    MessageRecord,
    SettingsRecord,
    PersonaRecord,
    ModuleRecord,
    PluginRecord,
    PresetRecord,
    ToolCallRecord,
    TranslationRecord,
    FileRecord,
    DatabaseWriteOperation,
    RoomRecord,
    DataScopeType
} from './types';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';

class DexieStore extends Dexie {
    rooms!: Table<RoomRecord, string>;
    characters!: Table<CharacterRecord, string>;
    chats!: Table<ChatRecord, string>;
    presets!: Table<PresetRecord, string>;
    messages!: Table<MessageRecord, string>;
    settings!: Table<SettingsRecord, string>;
    personas!: Table<PersonaRecord, string>;
    modules!: Table<ModuleRecord, string>;
    plugins!: Table<PluginRecord, string>;
    tool_calls!: Table<ToolCallRecord, string>;
    translations!: Table<TranslationRecord, string>;
    files!: Table<FileRecord, string>;

    constructor() {
        super('KeiLocalDB');

        this.version(1).stores({
            rooms: 'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            characters:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            chats: 'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+roomId], [scopeType+scopeId+updatedAt], roomId, updatedAt, isDeleted',
            presets:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            messages:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+chatId], [scopeType+scopeId+updatedAt], chatId, [chatId+sortOrder], updatedAt, isDeleted',
            settings:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            personas:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            modules:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            plugins:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            tool_calls:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+chatId], chatId, updatedAt, isDeleted',
            translations:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+chatId], [scopeType+scopeId+messageId], chatId, messageId, updatedAt, isDeleted',
            files: 'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+ownerId], [scopeType+scopeId+updatedAt], ownerId, updatedAt, isDeleted'
        });
    }
}

function scrubSoftDeletedRecord(record: DataRecord, updatedAt: number): void {
    record.isDeleted = true;
    record.updatedAt = updatedAt;
    record.assetEntries = undefined;
    record.data = {};
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

    private getTable<T extends DataRecord>(tableName: TableName): Table<T, string> {
        return this.db[tableName] as unknown as Table<T, string>;
    }

    async flush(): Promise<void> {
        return Promise.resolve();
    }

    async getRecord<T extends DataRecord>(
        tableName: TableName,
        id: string
    ): Promise<T | undefined> {
        return await this.getTable<T>(tableName).get(id);
    }

    async putRecord<T extends DataRecord>(
        tableName: TableName,
        record: T,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.getTable<T>(tableName).put(record);
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends DataRecord>(
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
        await this.getTable<DataRecord>(tableName).delete(id);
        this.emitWriteEvent(tableName, 'delete', [id], options);
    }

    async deleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const table = this.getTable<DataRecord>(tableName);
        const ids = (
            (await table.where(indexName).equals(indexValue).primaryKeys()) as string[]
        ).filter((id): id is string => typeof id === 'string');
        await table.where(indexName).equals(indexValue).delete();
        this.emitWriteEvent(tableName, 'deleteByIndex', ids, options);
    }

    async deleteByScope(
        tableName: TableName,
        scope: DataScope,
        options?: DatabaseWriteOptions
    ): Promise<number> {
        await this.flush();
        const table = this.getTable<DataRecord>(tableName);
        const ids = (
            (await table
                .where('[scopeType+scopeId]')
                .equals([scope.scopeType, scope.scopeId])
                .primaryKeys()) as string[]
        ).filter((id): id is string => typeof id === 'string');

        const count = await table
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .delete();

        this.emitWriteEvent(tableName, 'purge', ids, options);
        return count;
    }

    async softDeleteRecord(
        tableName: TableName,
        id: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        const record = await this.getRecord<DataRecord>(tableName, id);

        if (!record || record.isDeleted) return;

        scrubSoftDeletedRecord(record, clock.now());
        await this.putRecord(tableName, record, options);
    }

    async softDeleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const table = this.getTable<DataRecord>(tableName);
        const now = clock.now();
        const records = await table
            .where(indexName)
            .equals(indexValue)
            .filter((record) => !record.isDeleted)
            .toArray();
        if (records.length === 0) return;

        for (const record of records) {
            scrubSoftDeletedRecord(record, now);
        }
        await table.bulkPut(records);
        this.emitWriteEvent(
            tableName,
            'softDeleteByIndex',
            records.map((record) => record.id),
            options
        );
    }

    async softDeleteByCompoundIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const table = this.getTable<DataRecord>(tableName);
        const now = clock.now();
        const records = await table
            .where(indexName)
            .equals(indexValue)
            .filter((record) => !record.isDeleted)
            .toArray();
        if (records.length === 0) return;

        for (const record of records) {
            scrubSoftDeletedRecord(record, now);
        }
        await table.bulkPut(records);
        this.emitWriteEvent(
            tableName,
            'softDeleteByCompoundIndex',
            records.map((record) => record.id),
            options
        );
    }

    async getAll<T extends DataRecord>(tableName: TableName, scope: DataScope): Promise<T[]> {
        await this.flush();
        return (await this.getTable<T>(tableName)
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .filter((record: T) => !record.isDeleted)
            .sortBy('updatedAt')
            .then((results) => results.reverse())) as T[];
    }

    async getByIndex<T extends DataRecord>(
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

    async getScopeIdsByType(tableName: TableName, scopeType: DataScopeType): Promise<string[]> {
        await this.flush();
        const table = this.getTable<DataRecord>(tableName);
        // Using compound index [scopeType+scopeId] to scan all keys for a given scopeType.
        // .keys() returns only the index keys, avoiding full record loads.
        const keys = (await table
            .where('[scopeType+scopeId]')
            .between([scopeType, Dexie.minKey], [scopeType, Dexie.maxKey])
            .keys()) as unknown as [string, string][];

        const ids = new Set<string>();
        for (const key of keys) {
            if (Array.isArray(key) && key[0] === scopeType && key[1]) {
                ids.add(key[1]);
            }
        }
        return [...ids];
    }

    async getByCompoundIndex<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
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

    async getRecordsBackward<T extends DataRecord>(
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

    async getRecordsForward<T extends DataRecord>(
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
        return await this.getTable<DataRecord>(tableName)
            .where(indexName)
            .between(lowerBound, upperBound, false, false)
            .filter((record) => !record.isDeleted)
            .count();
    }

    async getUnsyncedChanges<T extends DataRecord>(
        tableName: TableName,
        scope: DataScope,
        sinceUpdatedAt: number
    ): Promise<T[]> {
        await this.flush();
        return (await this.getTable<T>(tableName)
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
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
        return await this.getTable<DataRecord>(tableName)
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
