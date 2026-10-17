import Database from '@tauri-apps/plugin-sql';
import type {
    IDatabaseAdapter,
    TableName,
    DataRecord,
    DataScope,
    DataScopeType,
    DatabaseWriteEventListener,
    DatabaseWriteOptions,
    DatabaseWriteOperation,
    DatabaseKeyEntry,
    SyncCheckpoint,
    SyncScopeState,
    TombstoneCollection
} from './types';
import { SYNC_TABLES, TABLES } from './types';
import { AppError } from '$lib/types/errors';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';
import { canonicalJson } from '$lib/utils/defaults';
import type { AssetEntries } from '$lib/types/asset';

/**
 * Tauri SQLite Local Database Adapter
 *
 * Uses @tauri-apps/plugin-sql.
 * Creates a unified row structure for all tables containing:
 *  - Primary `id`
 *  - Commonly indexed string/number columns
 *  - `data` column: JSON.stringified domain fields (plaintext)
 */

/** Raw shape of a database record as stored in SQLite */
interface DatabaseSqlRow {
    id: string;
    scopeType: string | null;
    scopeId: string | null;
    roomId: string | null;
    chatId: string | null;
    sortOrder: string | null;
    activeSwipeId: string | null;
    createdAt: number | null;
    updatedAt: number | null;
    localUpdatedAt: number;
    tombstoneAt: number | null;
    isDeleted: number; // 0 | 1
    assetEntries: string | null;
    data: string; // JSON.stringify(...)
}

interface RecordBindingShape {
    id: string;
    scopeType?: string;
    scopeId?: string;
    updatedAt?: number;
    isDeleted?: boolean;
    roomId?: string;
    chatId?: string;
    sortOrder?: string;
    activeSwipeId?: string;
    createdAt?: number;
    assetEntries?: AssetEntries;
    data?: Record<string, unknown>;
}

// Convert record to DB row bindings safely
function recordToBindings<T extends DataRecord>(record: T): DatabaseSqlRow {
    const clone: RecordBindingShape = { ...record };

    const bindings: DatabaseSqlRow = {
        id: clone.id,
        scopeType: clone.scopeType ?? null,
        scopeId: clone.scopeId ?? null,
        roomId: clone.roomId ?? null,
        chatId: clone.chatId ?? null,
        sortOrder: clone.sortOrder ?? null,
        activeSwipeId: clone.activeSwipeId ?? null,
        createdAt: clone.createdAt ?? null,
        updatedAt: clone.updatedAt ?? null,
        localUpdatedAt: 0,
        tombstoneAt: null,
        isDeleted: clone.isDeleted ? 1 : 0,
        assetEntries: clone.assetEntries ? canonicalJson(clone.assetEntries) : null,
        data: canonicalJson(clone.data ?? {})
    };

    return bindings;
}

function parseRecord<T>(row: DatabaseSqlRow): T {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
        id: row.id,
        scopeType: row.scopeType ?? 'user',
        scopeId: row.scopeId ?? '',
        roomId: row.roomId ?? undefined,
        chatId: row.chatId ?? undefined,
        sortOrder: row.sortOrder ?? undefined,
        activeSwipeId: row.activeSwipeId ?? undefined,
        createdAt: row.createdAt ?? 0,
        updatedAt: row.updatedAt ?? 0,
        localUpdatedAt: row.localUpdatedAt,
        tombstoneAt: row.tombstoneAt ?? undefined,
        isDeleted: row.isDeleted === 1,
        assetEntries: row.assetEntries ? (JSON.parse(row.assetEntries) as AssetEntries) : undefined,
        data
    } as T;
}

function scrubSoftDeletedRecord(record: DataRecord, updatedAt: number): void {
    record.isDeleted = true;
    record.updatedAt = updatedAt;
    record.assetEntries = undefined;
    record.data = {};
    Reflect.deleteProperty(record, 'activeSwipeId');
}

const RECORD_COLUMNS =
    'id, scopeType, scopeId, roomId, chatId, sortOrder, activeSwipeId, createdAt, updatedAt, localUpdatedAt, isDeleted, assetEntries, data, tombstoneAt';

/** Insert values whose tombstone records when this replica first held its current version. */
function recordValues(tableName: TableName, records: DataRecord[], now: number) {
    const values: unknown[] = [];
    const nowParam = records.length * 13 + 1;
    const placeholders = records
        .map((record, idx) => {
            const b = recordToBindings(record);
            values.push(
                b.id,
                b.scopeType,
                b.scopeId,
                b.roomId,
                b.chatId,
                b.sortOrder,
                b.activeSwipeId,
                b.createdAt,
                b.updatedAt,
                b.localUpdatedAt,
                b.isDeleted,
                b.assetEntries,
                b.data
            );
            const p = Array.from({ length: 13 }, (_, i) => `$${idx * 13 + i + 1}`);
            const tombstoneAt = `CASE WHEN ${p[10]} = 1 THEN COALESCE((SELECT tombstoneAt FROM ${tableName} WHERE id = ${p[0]} AND isDeleted = 1 AND updatedAt IS ${p[8]}), $${nowParam}) END`;
            return `(${p.join(', ')}, ${tombstoneAt})`;
        })
        .join(', ');
    values.push(now);
    return { placeholders, values };
}

function parseCompoundIndex(indexName: string): [string, string] | null {
    const cols = parseIndexColumns(indexName);
    if (!cols || cols.length !== 2) return null;
    return [cols[0], cols[1]];
}

function parseIndexColumns(indexName: string): string[] | null {
    const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
    if (!isComposite) return null;
    const cols = indexName.slice(1, -1).split('+');
    if (cols.length === 0 || cols.some((column) => !/^[A-Za-z][A-Za-z0-9]*$/.test(column))) {
        return null;
    }
    return cols;
}

/** Assign the local revision in the same SQL statement as the record write. */
export async function initSqlLocalUpdates(db: Database, tables: string[]): Promise<void> {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS local_updates (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO local_updates (id, value) VALUES (0, 0);
    `);
    for (const table of tables) {
        const columns = await db.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
        const domain = columns.filter(({ name }) => name !== 'localUpdatedAt');
        const equal = domain.map(({ name }) => `${name} IS NEW.${name}`).join(' AND ');
        const changed = domain.map(({ name }) => `OLD.${name} IS NOT NEW.${name}`).join(' OR ');
        const stamp = `
            UPDATE local_updates SET value = value + 1 WHERE id = 0;
            UPDATE ${table} SET localUpdatedAt = (SELECT value FROM local_updates WHERE id = 0)
            WHERE id = NEW.id;
        `;
        await db.execute(`
            CREATE TRIGGER IF NOT EXISTS ${table}_local_duplicate BEFORE INSERT ON ${table}
            WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${equal})
            BEGIN SELECT RAISE(IGNORE); END;
            CREATE TRIGGER IF NOT EXISTS ${table}_local_insert AFTER INSERT ON ${table}
            BEGIN ${stamp} END;
            CREATE TRIGGER IF NOT EXISTS ${table}_local_update AFTER UPDATE ON ${table}
            WHEN ${changed}
            BEGIN ${stamp} END;
        `);
    }
}

export async function getSqlLocalUpdatedAt(db: Database): Promise<number> {
    const rows = await db.select<Array<{ value: number }>>(
        'SELECT value FROM local_updates WHERE id = 0'
    );
    return rows[0].value;
}

export class TauriDatabaseAdapter implements IDatabaseAdapter {
    private dbPromise: Promise<Database> | null = null;
    private readonly writeEvents = new DatabaseWriteEventEmitter();
    private inTransaction = false;

    subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    async flush(): Promise<void> {
        return Promise.resolve();
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
        let sql = '';
        for (const table of TABLES) {
            sql += `
					CREATE TABLE IF NOT EXISTS "${table}" (
						id TEXT PRIMARY KEY,
						scopeType TEXT,
						scopeId TEXT,
                        roomId TEXT,
						chatId TEXT,
                        sortOrder TEXT,
                        activeSwipeId TEXT,
                        createdAt INTEGER,
                        updatedAt INTEGER,
                        localUpdatedAt INTEGER NOT NULL,
                        isDeleted INTEGER,
                        assetEntries TEXT,
                        data TEXT,
                        tombstoneAt INTEGER
					);
				`;

            // Optimized indices for lookup and sync
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scope_deleted" ON "${table}" (scopeType, scopeId, isDeleted);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scope_localUpdatedAt" ON "${table}" (scopeType, scopeId, localUpdatedAt);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scope_tombstoneAt" ON "${table}" (scopeType, scopeId, tombstoneAt);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scopeId" ON "${table}" (scopeId);
`;
        }
        sql += `CREATE TABLE IF NOT EXISTS sync_gc (
                    scopeType TEXT    NOT NULL,
                    scopeId   TEXT    NOT NULL,
                    gcHigh    INTEGER NOT NULL,
                    PRIMARY KEY (scopeType, scopeId)
                );
                CREATE TABLE IF NOT EXISTS sync_scope_state (
                    scopeType TEXT NOT NULL,
                    scopeId   TEXT NOT NULL,
                    state     TEXT NOT NULL,
                    PRIMARY KEY (scopeType, scopeId)
                );
                CREATE TABLE IF NOT EXISTS sync_checkpoints (
                    scopeType TEXT    NOT NULL,
                    scopeId   TEXT    NOT NULL,
                    id        TEXT    NOT NULL,
                    anchor    INTEGER NOT NULL,
                    heldAt    INTEGER NOT NULL,
                    createdAt INTEGER NOT NULL,
                    PRIMARY KEY (scopeType, scopeId, id)
                );
`;

        // FK indices for 1:N parent→child queries
        sql += `CREATE INDEX IF NOT EXISTS "idx_chats_roomId" ON chats (roomId);
`;
        // Compound index strictly required for pagination performance in messages
        sql += `CREATE INDEX IF NOT EXISTS "idx_messages_chatId_sortOrder" ON messages (chatId, sortOrder);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_chatId" ON tool_calls (chatId);
`;

        await db.execute(sql);

        await db.execute(
            `CREATE INDEX IF NOT EXISTS "idx_messages_identity"
             ON messages (chatId, sortOrder, activeSwipeId, scopeType, scopeId, id)`
        );
        await initSqlLocalUpdates(db, TABLES);
    }

    async getRecord<T extends DataRecord>(
        tableName: TableName,
        id: string
    ): Promise<T | undefined> {
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(`SELECT * FROM ${tableName} WHERE id = $1`, [
            id
        ]);
        if (rows.length > 0) return parseRecord<T>(rows[0]);
        return undefined;
    }

    async putRecord<T extends DataRecord>(
        tableName: TableName,
        record: T,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.writeRecords(tableName, [record]);
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends DataRecord>(
        tableName: TableName,
        records: T[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        records = [...new Map(records.map((record) => [record.id, record])).values()];
        await this.writeRecords(tableName, records);
        this.emitWriteEvent(
            tableName,
            'putMany',
            records.map((record) => record.id),
            options
        );
    }

    private async writeRecords(tableName: TableName, records: DataRecord[]): Promise<void> {
        const db = await this.getDb();
        const chunkSize = 50;
        const now = Date.now();
        for (let i = 0; i < records.length; i += chunkSize) {
            const { placeholders, values } = recordValues(
                tableName,
                records.slice(i, i + chunkSize),
                now
            );
            await db.execute(
                `INSERT OR REPLACE INTO ${tableName} (${RECORD_COLUMNS}) VALUES ${placeholders}`,
                values
            );
        }
    }

    async deleteRecord(
        tableName: TableName,
        id: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.deleteRows(tableName, 'id = $1', [id]);
        this.emitWriteEvent(tableName, 'delete', [id], options);
    }

    async deleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const ids = await this.deleteRows(tableName, `${indexName} = $1`, [indexValue]);
        this.emitWriteEvent(tableName, 'deleteByIndex', ids, options);
    }

    async deleteByScope(
        tableName: TableName,
        scope: DataScope,
        options?: DatabaseWriteOptions
    ): Promise<number> {
        await this.flush();
        const ids = await this.deleteRows(tableName, 'scopeType = $1 AND scopeId = $2', [
            scope.scopeType,
            scope.scopeId
        ]);
        this.emitWriteEvent(tableName, 'purge', ids, options);
        return ids.length;
    }

    /**
     * A hard-deleted sync tombstone is forgotten. Its scope watermark rises first, and the
     * delete skips any tombstone written above it meanwhile, so no interleaving loses one.
     */
    private async deleteRows(
        tableName: TableName,
        where: string,
        params: unknown[]
    ): Promise<string[]> {
        const db = await this.getDb();
        let condition = where;
        if (SYNC_TABLES.includes(tableName)) {
            await db.execute(
                `INSERT INTO sync_gc (scopeType, scopeId, gcHigh)
                 SELECT scopeType, scopeId, MAX(localUpdatedAt) FROM ${tableName}
                 WHERE (${where}) AND isDeleted = 1
                 GROUP BY scopeType, scopeId
                 ON CONFLICT(scopeType, scopeId) DO UPDATE SET gcHigh = MAX(gcHigh, excluded.gcHigh)`,
                params
            );
            condition = `(${where}) AND (isDeleted = 0 OR localUpdatedAt <= COALESCE(
                (SELECT gcHigh FROM sync_gc g
                 WHERE g.scopeType = ${tableName}.scopeType AND g.scopeId = ${tableName}.scopeId), 0))`;
        }
        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM ${tableName} WHERE ${condition}`,
            params
        );
        await db.execute(`DELETE FROM ${tableName} WHERE ${condition}`, params);
        return rows.map((row) => row.id);
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
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE ${indexName} = $1 AND isDeleted = 0`,
            [indexValue]
        );
        const now = clock.now();
        const recordsToUpdate: DataRecord[] = [];

        for (const row of rows) {
            const record = parseRecord<DataRecord>(row);
            scrubSoftDeletedRecord(record, now);
            recordsToUpdate.push(record);
        }

        if (recordsToUpdate.length > 0) {
            await this.writeRecords(tableName, recordsToUpdate);
            this.emitWriteEvent(
                tableName,
                'softDeleteByIndex',
                recordsToUpdate.map((r) => r.id),
                options
            );
        }
    }

    async softDeleteByCompoundIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        await this.flush();
        const db = await this.getDb();
        const cols = parseCompoundIndex(indexName);
        if (!cols) {
            throw new AppError(
                'INVALID_INPUT',
                `Unsupported indexName for softDeleteByCompoundIndex: ${indexName}`
            );
        }

        const [col1, col2] = cols;
        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM ${tableName} WHERE ${col1} = $1 AND ${col2} = $2 AND isDeleted = 0`,
            [indexValue[0], indexValue[1]]
        );
        const now = clock.now();
        if (rows.length === 0) return;

        await db.execute(
            `UPDATE ${tableName} SET isDeleted = 1, updatedAt = $3, tombstoneAt = $4, activeSwipeId = NULL, assetEntries = NULL, data = '{}' WHERE ${col1} = $1 AND ${col2} = $2 AND isDeleted = 0`,
            [indexValue[0], indexValue[1], now, Date.now()]
        );
        this.emitWriteEvent(
            tableName,
            'softDeleteByCompoundIndex',
            rows.map((row) => row.id),
            options
        );
    }

    async getAll<T extends DataRecord>(tableName: TableName, scope: DataScope): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE scopeType = $1 AND scopeId = $2 AND isDeleted = 0 ORDER BY updatedAt DESC`,
            [scope.scopeType, scope.scopeId]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async getByIndex<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE ${indexName} = $1 AND isDeleted = 0 LIMIT $2 OFFSET $3`,
            [indexValue, limit, offset]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async getScopeIdsByType(tableName: TableName, scopeType: string): Promise<string[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<{ scopeId: string | null }[]>(
            `SELECT DISTINCT scopeId FROM ${tableName} WHERE scopeType = $1`,
            [scopeType]
        );
        return rows.map((row) => row.scopeId).filter((id): id is string => !!id);
    }

    async getByCompoundIndex<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const cols = parseCompoundIndex(indexName);
        if (!cols) {
            throw new AppError(
                'INVALID_INPUT',
                `Unsupported indexName for getByCompoundIndex: ${indexName}`
            );
        }

        const [col1, col2] = cols;
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE ${col1} = $1 AND ${col2} = $2 AND isDeleted = 0 LIMIT $3 OFFSET $4`,
            [indexValue[0], indexValue[1], limit, offset]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async getRecordsBackward<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();

        const cols = parseCompoundIndex(indexName);
        if (cols) {
            const col1 = cols[0];
            const col2 = cols[1];

            const val1 = lowerBound[0];
            const lower2 = lowerBound[1];
            const upper2 = upperBound[1];

            const query = `SELECT * FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} DESC LIMIT $4 OFFSET $5`;
            const rows = await db.select<DatabaseSqlRow[]>(query, [
                val1,
                lower2,
                upper2,
                limit,
                offset
            ]);
            return rows.map((row) => parseRecord<T>(row));
        }

        throw new AppError(
            'INVALID_INPUT',
            `Unsupported indexName for getRecordsBackward: ${indexName}`
        );
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
        const db = await this.getDb();

        const cols = parseCompoundIndex(indexName);
        if (cols) {
            const col1 = cols[0];
            const col2 = cols[1];

            const val1 = lowerBound[0];
            const lower2 = lowerBound[1];
            const upper2 = upperBound[1];

            const query = `SELECT * FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} ASC LIMIT $4 OFFSET $5`;
            const rows = await db.select<DatabaseSqlRow[]>(query, [
                val1,
                lower2,
                upper2,
                limit,
                offset
            ]);
            return rows.map((row) => parseRecord<T>(row));
        }

        throw new AppError(
            'INVALID_INPUT',
            `Unsupported indexName for getRecordsForward: ${indexName}`
        );
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
        const db = await this.getDb();
        const columns = parseIndexColumns(indexName);
        if (!columns || columns.length < 2) {
            throw new AppError('INVALID_INPUT', `Unsupported indexName for getKeys: ${indexName}`);
        }
        const partition = lowerBound[0];
        const after = lowerBound[1];
        const before = upperBound[1];
        const rows = await db.select<Array<Record<string, unknown>>>(
            `SELECT id, ${columns.join(', ')}
             FROM ${tableName}
             WHERE ${columns[0]} = $1
               AND ${columns[1]} > $2
               AND ${columns[1]} < $3
               AND isDeleted = 0
             ORDER BY ${columns[1]} ASC
             LIMIT $4 OFFSET $5`,
            [partition, after, before, limit, offset]
        );
        return rows.map((row) => this.toDatabaseKeyEntry(row, columns));
    }

    private toDatabaseKeyEntry(row: Record<string, unknown>, columns: string[]): DatabaseKeyEntry {
        return {
            primaryKey: String(row.id),
            indexKey: columns.map((column) => String(row[column] ?? '')),
            scopeType: row.scopeType as DataScopeType,
            scopeId: String(row.scopeId)
        };
    }

    async countRecordsInRange(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[]
    ): Promise<number> {
        await this.flush();
        const db = await this.getDb();

        const cols = parseCompoundIndex(indexName);
        if (cols) {
            const col1 = cols[0];
            const col2 = cols[1];

            const val1 = lowerBound[0];
            const lower2 = lowerBound[1];
            const upper2 = upperBound[1];

            const query = `SELECT COUNT(*) FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0`;
            const rows = await db.select<{ 'COUNT(*)': number }[]>(query, [val1, lower2, upper2]);
            return rows[0]?.['COUNT(*)'] ?? 0;
        }

        throw new AppError(
            'INVALID_INPUT',
            `Unsupported indexName for countRecordsInRange: ${indexName}`
        );
    }

    async getLocalUpdatedAt(): Promise<number> {
        return getSqlLocalUpdatedAt(await this.getDb());
    }

    async getUnsyncedChanges<T extends DataRecord>(
        tableName: TableName,
        scope: DataScope,
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE scopeType = $1 AND scopeId = $2 AND localUpdatedAt > $3 AND localUpdatedAt <= $4`,
            [scope.scopeType, scope.scopeId, afterLocalUpdatedAt, throughLocalUpdatedAt]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async transaction<R>(
        _tables: TableName[],
        _mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R> {
        if (this.inTransaction) {
            // Already in a transaction, just run the callback
            return await callback();
        }

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

    async countByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string
    ): Promise<number> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<{ 'COUNT(*)': number }[]>(
            `SELECT COUNT(*) FROM ${tableName} WHERE ${indexName} = $1 AND isDeleted = 0`,
            [indexValue]
        );
        return rows[0]?.['COUNT(*)'] ?? 0;
    }

    async getSyncGcHigh(scope: DataScope): Promise<number> {
        const db = await this.getDb();
        const rows = await db.select<Array<{ gcHigh: number }>>(
            'SELECT gcHigh FROM sync_gc WHERE scopeType = $1 AND scopeId = $2',
            [scope.scopeType, scope.scopeId]
        );
        return rows[0]?.gcHigh ?? 0;
    }

    async collectTombstones(scope: DataScope, options: TombstoneCollection): Promise<number> {
        await this.flush();
        const db = await this.getDb();
        const expired =
            'scopeType = $1 AND scopeId = $2 AND isDeleted = 1 AND tombstoneAt <= $3 AND localUpdatedAt <= $4';
        const params = [
            scope.scopeType,
            scope.scopeId,
            options.receivedThrough,
            options.throughLocalUpdatedAt
        ];
        let high = 0;
        for (const table of SYNC_TABLES) {
            const rows = await db.select<Array<{ high: number | null }>>(
                `SELECT MAX(localUpdatedAt) AS high FROM ${table} WHERE ${expired}`,
                params
            );
            high = Math.max(high, rows[0]?.high ?? 0);
        }
        if (high > 0) {
            // Raise the watermark first; only tombstones at or below it are then removed.
            await db.execute(
                `INSERT INTO sync_gc (scopeType, scopeId, gcHigh) VALUES ($1, $2, $3)
                 ON CONFLICT(scopeType, scopeId) DO UPDATE SET gcHigh = MAX(gcHigh, excluded.gcHigh)`,
                [scope.scopeType, scope.scopeId, high]
            );
            for (const table of SYNC_TABLES) {
                await db.execute(`DELETE FROM ${table} WHERE ${expired} AND localUpdatedAt <= $5`, [
                    ...params,
                    high
                ]);
            }
        }
        return await this.getSyncGcHigh(scope);
    }

    async getSyncCheckpoints(scope: DataScope): Promise<SyncCheckpoint[]> {
        const db = await this.getDb();
        return await db.select<SyncCheckpoint[]>(
            `SELECT id, anchor, heldAt, createdAt FROM sync_checkpoints
             WHERE scopeType = $1 AND scopeId = $2`,
            [scope.scopeType, scope.scopeId]
        );
    }

    async addSyncCheckpoints(
        scope: DataScope,
        checkpoints: Array<Pick<SyncCheckpoint, 'id' | 'anchor'>>
    ): Promise<void> {
        const known = new Set((await this.getSyncCheckpoints(scope)).map(({ id }) => id));
        const added = checkpoints.filter(({ id }) => !known.has(id));
        if (added.length === 0) return;
        const db = await this.getDb();
        // heldAt is the next revision, and it is allocated only after the insert: a Push bound
        // read in between is still below heldAt, so the checkpoint stays in a later Push range.
        const values: unknown[] = [scope.scopeType, scope.scopeId, Date.now()];
        const rows = added.map(({ id, anchor }) => {
            values.push(id, anchor);
            const n = values.length;
            return `($1, $2, $${n - 1}, $${n}, (SELECT value + 1 FROM local_updates WHERE id = 0), $3)`;
        });
        await db.execute(
            `INSERT OR IGNORE INTO sync_checkpoints (scopeType, scopeId, id, anchor, heldAt, createdAt)
             VALUES ${rows.join(', ')}`,
            values
        );
        await db.execute('UPDATE local_updates SET value = value + 1 WHERE id = 0');
    }

    async pruneSyncCheckpoints(scope: DataScope, createdBefore: number): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            'DELETE FROM sync_checkpoints WHERE scopeType = $1 AND scopeId = $2 AND createdAt < $3',
            [scope.scopeType, scope.scopeId, createdBefore]
        );
    }

    async getSyncScopeState(scope: DataScope): Promise<SyncScopeState> {
        const db = await this.getDb();
        const rows = await db.select<Array<{ state: string }>>(
            'SELECT state FROM sync_scope_state WHERE scopeType = $1 AND scopeId = $2',
            [scope.scopeType, scope.scopeId]
        );
        return rows[0]
            ? (JSON.parse(rows[0].state) as SyncScopeState)
            : { lineage: null, adopting: false, bootstrapping: null };
    }

    async setSyncScopeState(scope: DataScope, state: SyncScopeState): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT INTO sync_scope_state (scopeType, scopeId, state) VALUES ($1, $2, $3)
             ON CONFLICT(scopeType, scopeId) DO UPDATE SET state = excluded.state`,
            [scope.scopeType, scope.scopeId, JSON.stringify(state)]
        );
    }

    async hasScopeRecords(scope: DataScope): Promise<boolean> {
        const db = await this.getDb();
        for (const table of SYNC_TABLES) {
            const rows = await db.select<Array<{ id: string }>>(
                `SELECT id FROM ${table} WHERE scopeType = $1 AND scopeId = $2 LIMIT 1`,
                [scope.scopeType, scope.scopeId]
            );
            if (rows.length > 0) return true;
        }
        return false;
    }

    /**
     * Not atomic on the plugin's connection pool; the `adopting` mark makes any partial
     * reset restart from the beginning instead of being used.
     */
    async resetSyncScope(scope: DataScope): Promise<void> {
        await this.flush();
        if (!(await this.getSyncScopeState(scope)).adopting) {
            throw new Error('Only an adopting scope may be reset');
        }
        const db = await this.getDb();
        const params = [scope.scopeType, scope.scopeId];
        for (const table of SYNC_TABLES) {
            const rows = await db.select<{ id: string }[]>(
                `SELECT id FROM ${table} WHERE scopeType = $1 AND scopeId = $2`,
                params
            );
            await db.execute(`DELETE FROM ${table} WHERE scopeType = $1 AND scopeId = $2`, params);
            this.emitWriteEvent(
                table,
                'purge',
                rows.map((row) => row.id),
                { origin: 'sync' }
            );
        }
        await db.execute('DELETE FROM sync_gc WHERE scopeType = $1 AND scopeId = $2', params);
        await db.execute(
            'DELETE FROM sync_checkpoints WHERE scopeType = $1 AND scopeId = $2',
            params
        );
    }

    async adoptSyncState(
        scope: DataScope,
        adopted: { forgotten: boolean; checkpoints: string[] }
    ): Promise<void> {
        const db = await this.getDb();
        // Written at the next revision before allocating it, as in addSyncCheckpoints.
        const next = '(SELECT value + 1 FROM local_updates WHERE id = 0)';
        await db.execute(
            `INSERT INTO sync_gc (scopeType, scopeId, gcHigh) VALUES ($1, $2, ${adopted.forgotten ? next : '0'})
             ON CONFLICT(scopeType, scopeId) DO UPDATE SET gcHigh = excluded.gcHigh`,
            [scope.scopeType, scope.scopeId]
        );
        if (adopted.checkpoints.length > 0) {
            const values: unknown[] = [scope.scopeType, scope.scopeId, Date.now()];
            const rows = adopted.checkpoints.map((id) => {
                values.push(id);
                return `($1, $2, $${values.length}, ${next}, ${next}, $3)`;
            });
            await db.execute(
                `INSERT OR REPLACE INTO sync_checkpoints (scopeType, scopeId, id, anchor, heldAt, createdAt)
                 VALUES ${rows.join(', ')}`,
                values
            );
        }
        await db.execute('UPDATE local_updates SET value = value + 1 WHERE id = 0');
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
