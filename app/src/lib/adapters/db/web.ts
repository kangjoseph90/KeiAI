/**
 * Dexie-based Local Database Adapter (Web / PWA)
 *
 * All tables store plaintext JSON in the `data` field.
 * Encryption happens only at the sync boundary (Sync Engine).
 */
import Dexie, { type Collection, type Table } from 'dexie';
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
    DatabaseKeyEntry,
    SettingsRecord,
    PersonaRecord,
    ModuleRecord,
    PluginRecord,
    PresetRecord,
    ToolCallRecord,
    DatabaseWriteOperation,
    RoomRecord,
    DataScopeType,
    SyncCheckpoint,
    SyncScopeState,
    TombstoneCollection
} from './types';
import { SYNC_TABLES } from './types';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';
import { canonicalJson } from '$lib/utils/defaults';

/**
 * A single persistent revision shared by all writes in this IndexedDB database.
 * With `trackTombstones`, a tombstone records when this replica first held its current
 * version; duplicate receives keep that time.
 */
export async function putWebRecords<
    T extends { id: string; localUpdatedAt?: number; isDeleted?: boolean; tombstoneAt?: number }
>(db: Dexie, table: Table<T, string>, records: T[], trackTombstones = false): Promise<void> {
    records = [...new Map(records.map((record) => [record.id, record])).values()];
    const revisions = db.table<{ id: number; value: number }, number>('localUpdates');
    const now = Date.now();
    await db.transaction('rw', table, revisions, async () => {
        let value = (await revisions.get(0))?.value ?? 0;
        const existing = await table.bulkGet(records.map((record) => record.id));
        await table.bulkPut(
            records.map((record, i) => {
                const { localUpdatedAt: _incoming, tombstoneAt: _received, ...state } = record;
                const {
                    localUpdatedAt: previous,
                    tombstoneAt: receivedAt,
                    ...before
                } = existing[i] ?? {};
                const unchanged = !!existing[i] && canonicalJson(state) === canonicalJson(before);
                const next = { ...state, localUpdatedAt: unchanged ? previous : ++value } as T;
                if (trackTombstones && record.isDeleted) {
                    next.tombstoneAt = unchanged && receivedAt !== undefined ? receivedAt : now;
                }
                return next;
            })
        );
        await revisions.put({ id: 0, value });
    });
}

export async function getWebLocalUpdatedAt(db: Dexie): Promise<number> {
    return (
        (await db.table<{ id: number; value: number }, number>('localUpdates').get(0))?.value ?? 0
    );
}

interface SyncGcRow extends DataScope {
    gcHigh: number;
}

type SyncCheckpointRow = DataScope & SyncCheckpoint;

type SyncScopeStateRow = DataScope & SyncScopeState;

const EMPTY_SCOPE_STATE: SyncScopeState = { lineage: null, adopting: null, bootstrapping: null };

class DexieStore extends Dexie {
    syncGc!: Table<SyncGcRow, [string, string]>;
    syncCheckpoints!: Table<SyncCheckpointRow, [string, string, string]>;
    syncScopeState!: Table<SyncScopeStateRow, [string, string]>;
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

    constructor() {
        super('KeiLocalDB');

        this.version(1).stores({
            localUpdates: 'id',
            syncGc: '[scopeType+scopeId]',
            syncCheckpoints: '[scopeType+scopeId+id], [scopeType+scopeId]',
            syncScopeState: '[scopeType+scopeId]',
            rooms: 'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            characters:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            chats: 'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+roomId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], roomId, updatedAt, isDeleted',
            presets:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            messages:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+chatId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], chatId, [chatId+sortOrder], [chatId+sortOrder+activeSwipeId+scopeType+scopeId], updatedAt, isDeleted',
            settings:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            personas:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            modules:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            plugins:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+localUpdatedAt], [scopeType+scopeId+tombstoneAt], updatedAt, isDeleted',
            tool_calls:
                'id, scopeId, [scopeType+scopeId], [scopeType+scopeId+chatId], chatId, updatedAt, isDeleted'
        });
    }
}

function scrubSoftDeletedRecord(record: DataRecord, updatedAt: number): void {
    record.isDeleted = true;
    record.updatedAt = updatedAt;
    record.assetEntries = undefined;
    record.data = {};
    Reflect.deleteProperty(record, 'activeSwipeId');
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
        await putWebRecords(this.db, this.getTable<T>(tableName), [record], true);
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends DataRecord>(
        tableName: TableName,
        records: T[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await putWebRecords(this.db, this.getTable<T>(tableName), records, true);
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
        await this.deleteRows(tableName, (table) => table.where('id').equals(id));
        this.emitWriteEvent(tableName, 'delete', [id], options);
    }

    async deleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const ids = await this.deleteRows(tableName, (table) =>
            table.where(indexName).equals(indexValue)
        );
        this.emitWriteEvent(tableName, 'deleteByIndex', ids, options);
    }

    async deleteByScope(
        tableName: TableName,
        scope: DataScope,
        options?: DatabaseWriteOptions
    ): Promise<number> {
        await this.flush();
        const ids = await this.deleteRows(tableName, (table) =>
            table.where('[scopeType+scopeId]').equals([scope.scopeType, scope.scopeId])
        );
        this.emitWriteEvent(tableName, 'purge', ids, options);
        return ids.length;
    }

    /** A hard-deleted sync tombstone is forgotten: raise its scope watermark in the same commit. */
    private async deleteRows(
        tableName: TableName,
        select: (table: Table<DataRecord, string>) => Collection<DataRecord, string>
    ): Promise<string[]> {
        const table = this.getTable<DataRecord>(tableName);
        return await this.db.transaction('rw', table, this.db.syncGc, async () => {
            const rows = await select(table).toArray();
            if (SYNC_TABLES.includes(tableName)) {
                for (const tombstone of rows.filter((row) => row.isDeleted)) {
                    await this.raiseGcHigh(tombstone, tombstone.localUpdatedAt ?? 0);
                }
            }
            const ids = rows.map((row) => row.id);
            await table.bulkDelete(ids);
            return ids;
        });
    }

    private async raiseGcHigh(scope: DataScope, gcHigh: number): Promise<number> {
        const key: [string, string] = [scope.scopeType, scope.scopeId];
        const current = (await this.db.syncGc.get(key))?.gcHigh ?? 0;
        if (gcHigh > current) {
            await this.db.syncGc.put({
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                gcHigh
            });
        }
        return Math.max(current, gcHigh);
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
        await putWebRecords(this.db, table, records, true);
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
        await putWebRecords(this.db, table, records, true);
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

    async getKeys(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit = 50,
        offset = 0
    ): Promise<DatabaseKeyEntry[]> {
        await this.flush();
        const columns = indexName.slice(1, -1).split('+');
        const collection = this.getTable<DataRecord>(tableName)
            .where(indexName)
            .between([...lowerBound, '\uffff'], upperBound, false, false);
        const entries: DatabaseKeyEntry[] = [];
        await collection
            .offset(offset)
            .limit(limit)
            .eachKey((key, cursor) => {
                const indexKey = key as string[];
                entries.push({
                    primaryKey: String(cursor.primaryKey),
                    indexKey,
                    scopeType: indexKey[columns.indexOf('scopeType')] as DataScopeType,
                    scopeId: indexKey[columns.indexOf('scopeId')]
                });
            });
        return entries;
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

    getLocalUpdatedAt(): Promise<number> {
        return getWebLocalUpdatedAt(this.db);
    }

    async getUnsyncedChanges<T extends DataRecord>(
        tableName: TableName,
        scope: DataScope,
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<T[]> {
        await this.flush();
        return (await this.getTable<T>(tableName)
            .where('[scopeType+scopeId+localUpdatedAt]')
            .between(
                [scope.scopeType, scope.scopeId, afterLocalUpdatedAt],
                [scope.scopeType, scope.scopeId, throughLocalUpdatedAt],
                false,
                true
            )
            .toArray()) as T[];
    }

    async transaction<R>(
        tables: TableName[],
        mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R> {
        await this.flush();
        return await this.db.transaction(mode, [...tables, 'localUpdates', 'syncGc'], callback);
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

    async getSyncGcHigh(scope: DataScope): Promise<number> {
        return (await this.db.syncGc.get([scope.scopeType, scope.scopeId]))?.gcHigh ?? 0;
    }

    async collectTombstones(scope: DataScope, options: TombstoneCollection): Promise<number> {
        await this.flush();
        const tables = SYNC_TABLES.map((tableName) => this.getTable<DataRecord>(tableName));
        return await this.db.transaction('rw', [...tables, this.db.syncGc], async () => {
            const expired = await Promise.all(
                tables.map((table) =>
                    table
                        .where('[scopeType+scopeId+tombstoneAt]')
                        .between(
                            [scope.scopeType, scope.scopeId, Dexie.minKey],
                            [scope.scopeType, scope.scopeId, options.receivedThrough],
                            true,
                            true
                        )
                        .filter(
                            (record) =>
                                record.isDeleted &&
                                (record.localUpdatedAt ?? 0) <= options.throughLocalUpdatedAt
                        )
                        .toArray()
                )
            );
            const gcHigh = await this.raiseGcHigh(
                scope,
                Math.max(0, ...expired.flat().map((record) => record.localUpdatedAt ?? 0))
            );
            await Promise.all(
                tables.map((table, i) => table.bulkDelete(expired[i].map((record) => record.id)))
            );
            return gcHigh;
        });
    }

    async getSyncCheckpoints(scope: DataScope): Promise<SyncCheckpoint[]> {
        const rows = await this.db.syncCheckpoints
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .toArray();
        return rows.map(({ id, anchor, heldAt, createdAt }) => ({ id, anchor, heldAt, createdAt }));
    }

    async addSyncCheckpoints(
        scope: DataScope,
        checkpoints: Array<Pick<SyncCheckpoint, 'id' | 'anchor'>>
    ): Promise<void> {
        if (checkpoints.length === 0) return;
        const revisions = this.db.table<{ id: number; value: number }, number>('localUpdates');
        await this.db.transaction('rw', this.db.syncCheckpoints, revisions, async () => {
            const keys = checkpoints.map(({ id }): [string, string, string] => [
                scope.scopeType,
                scope.scopeId,
                id
            ]);
            const existing = await this.db.syncCheckpoints.bulkGet(keys);
            const added = checkpoints.filter((_, i) => !existing[i]);
            if (added.length === 0) return;
            // A fresh revision orders the inheritance after every Push bound read before it.
            const heldAt = ((await revisions.get(0))?.value ?? 0) + 1;
            const createdAt = Date.now();
            await this.db.syncCheckpoints.bulkPut(
                added.map(({ id, anchor }) => ({ ...scope, id, anchor, heldAt, createdAt }))
            );
            await revisions.put({ id: 0, value: heldAt });
        });
    }

    async pruneSyncCheckpoints(scope: DataScope, createdBefore: number): Promise<void> {
        await this.db.syncCheckpoints
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .filter((checkpoint) => checkpoint.createdAt < createdBefore)
            .delete();
    }

    async getSyncScopeState(scope: DataScope): Promise<SyncScopeState> {
        const row = await this.db.syncScopeState.get([scope.scopeType, scope.scopeId]);
        if (!row) return { ...EMPTY_SCOPE_STATE };
        const { lineage, adopting, bootstrapping } = row;
        return { lineage, adopting, bootstrapping };
    }

    async setSyncScopeState(scope: DataScope, state: SyncScopeState): Promise<void> {
        await this.db.syncScopeState.put({
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            ...state
        });
    }

    async hasScopeRecords(scope: DataScope): Promise<boolean> {
        for (const tableName of SYNC_TABLES) {
            const count = await this.getTable<DataRecord>(tableName)
                .where('[scopeType+scopeId]')
                .equals([scope.scopeType, scope.scopeId])
                .limit(1)
                .count();
            if (count > 0) return true;
        }
        return false;
    }

    async resetSyncScope(scope: DataScope, options?: { keepRecords?: boolean }): Promise<void> {
        await this.flush();
        const key: [string, string] = [scope.scopeType, scope.scopeId];
        const tables = options?.keepRecords
            ? []
            : SYNC_TABLES.map((tableName) => this.getTable<DataRecord>(tableName));
        const removed = await this.db.transaction(
            'rw',
            [...tables, this.db.syncGc, this.db.syncCheckpoints, this.db.syncScopeState],
            async () => {
                if (!(await this.db.syncScopeState.get(key))?.adopting) {
                    throw new Error('Only an adopting scope may be reset');
                }
                const ids = await Promise.all(
                    tables.map(async (table) => {
                        const collection = table.where('[scopeType+scopeId]').equals(key);
                        const primaryKeys = (await collection.primaryKeys()) as string[];
                        await collection.delete();
                        return primaryKeys;
                    })
                );
                await this.db.syncGc.delete(key);
                await this.db.syncCheckpoints.where('[scopeType+scopeId]').equals(key).delete();
                return ids;
            }
        );
        removed.forEach((ids, i) =>
            this.emitWriteEvent(SYNC_TABLES[i], 'purge', ids, { origin: 'sync' })
        );
    }

    async adoptSyncState(
        scope: DataScope,
        adopted: { forgotten: boolean; checkpoints: string[] }
    ): Promise<void> {
        const revisions = this.db.table<{ id: number; value: number }, number>('localUpdates');
        await this.db.transaction(
            'rw',
            [this.db.syncGc, this.db.syncCheckpoints, revisions],
            async () => {
                const revision = ((await revisions.get(0))?.value ?? 0) + 1;
                const createdAt = Date.now();
                await this.db.syncGc.put({
                    scopeType: scope.scopeType,
                    scopeId: scope.scopeId,
                    gcHigh: adopted.forgotten ? revision : 0
                });
                await this.db.syncCheckpoints.bulkPut(
                    adopted.checkpoints.map((id) => ({
                        ...scope,
                        id,
                        anchor: revision,
                        heldAt: revision,
                        createdAt
                    }))
                );
                await revisions.put({ id: 0, value: revision });
            }
        );
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
