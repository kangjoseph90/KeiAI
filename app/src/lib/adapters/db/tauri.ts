import Database from '@tauri-apps/plugin-sql';
import type {
    IDatabaseAdapter,
    TableName,
    DataRecord,
    DataScope,
    DatabaseWriteEventListener,
    DatabaseWriteOptions,
    DatabaseWriteOperation
} from './types';
import { TABLES } from './types';
import { AppError } from '$lib/types/errors';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';
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
    messageId: string | null;
    sortOrder: string | null;
    ownerId: string | null;
    createdAt: number | null;
    updatedAt: number | null;
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
    messageId?: string;
    sortOrder?: string;
    ownerId?: string;
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
        messageId: clone.messageId ?? null,
        sortOrder: clone.sortOrder ?? null,
        ownerId: clone.ownerId ?? null,
        createdAt: clone.createdAt ?? null,
        updatedAt: clone.updatedAt ?? null,
        isDeleted: clone.isDeleted ? 1 : 0,
        assetEntries: clone.assetEntries ? JSON.stringify(clone.assetEntries) : null,
        data: JSON.stringify(clone.data ?? {})
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
        messageId: row.messageId ?? undefined,
        sortOrder: row.sortOrder ?? undefined,
        ownerId: row.ownerId ?? undefined,
        createdAt: row.createdAt ?? 0,
        updatedAt: row.updatedAt ?? 0,
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
}

function parseCompoundIndex(indexName: string): [string, string] | null {
    const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
    if (!isComposite) return null;
    const cols = indexName.slice(1, -1).split('+');
    if (cols.length !== 2) return null;
    return [cols[0], cols[1]];
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
						messageId TEXT,
                        sortOrder TEXT,
                        ownerId TEXT,
                        createdAt INTEGER,
                        updatedAt INTEGER,
                        isDeleted INTEGER,
                        assetEntries TEXT,
                        data TEXT
					);
				`;

            // Optimized indices for lookup and sync
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scope_deleted" ON "${table}" (scopeType, scopeId, isDeleted);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scope_updatedAt" ON "${table}" (scopeType, scopeId, updatedAt);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_scopeId" ON "${table}" (scopeId);
`;
        }

        // FK indices for 1:N parent→child queries
        sql += `CREATE INDEX IF NOT EXISTS "idx_chats_roomId" ON chats (roomId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_files_ownerId" ON files (ownerId);
`;

        // Compound index strictly required for pagination performance in messages
        sql += `CREATE INDEX IF NOT EXISTS "idx_messages_chatId_sortOrder" ON messages (chatId, sortOrder);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_chatId" ON tool_calls (chatId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_chatId" ON translations (chatId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_messageId" ON translations (messageId);
`;

        await db.execute(sql);
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
        const db = await this.getDb();
        const b = recordToBindings(record);
        await db.execute(
            `INSERT OR REPLACE INTO ${tableName}
				(id, scopeType, scopeId, roomId, chatId, messageId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, assetEntries, data)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                b.id,
                b.scopeType,
                b.scopeId,
                b.roomId,
                b.chatId,
                b.messageId,
                b.sortOrder,
                b.ownerId,
                b.createdAt,
                b.updatedAt,
                b.isDeleted,
                b.assetEntries,
                b.data
            ]
        );
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends DataRecord>(
        tableName: TableName,
        records: T[],
        options?: DatabaseWriteOptions
    ): Promise<void> {
        const db = await this.getDb();
        const chunkSize = 50;

        for (let i = 0; i < records.length; i += chunkSize) {
            const chunk = records.slice(i, i + chunkSize);
            const placeholders = chunk
                .map((_, idx) => {
                    const start = idx * 13 + 1;
                    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11}, $${start + 12})`;
                })
                .join(', ');

            const values: unknown[] = [];
            for (const record of chunk) {
                const b = recordToBindings(record);
                values.push(
                    b.id,
                    b.scopeType,
                    b.scopeId,
                    b.roomId,
                    b.chatId,
                    b.messageId,
                    b.sortOrder,
                    b.ownerId,
                    b.createdAt,
                    b.updatedAt,
                    b.isDeleted,
                    b.assetEntries,
                    b.data
                );
            }

            await db.execute(
                `INSERT OR REPLACE INTO ${tableName}
					(id, scopeType, scopeId, roomId, chatId, messageId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, assetEntries, data)
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
    }

    async deleteRecord(
        tableName: TableName,
        id: string,
        options?: DatabaseWriteOptions
    ): Promise<void> {
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

    async deleteByScope(
        tableName: TableName,
        scope: DataScope,
        options?: DatabaseWriteOptions
    ): Promise<number> {
        await this.flush();
        const db = await this.getDb();

        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM ${tableName} WHERE scopeType = $1 AND scopeId = $2`,
            [scope.scopeType, scope.scopeId]
        );
        if (rows.length === 0) return 0;

        const ids = rows.map((row) => row.id);
        const result = await db.execute(
            `DELETE FROM ${tableName} WHERE scopeType = $1 AND scopeId = $2`,
            [scope.scopeType, scope.scopeId]
        );

        this.emitWriteEvent(tableName, 'purge', ids, options);
        return result.rowsAffected;
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
            const chunkSize = 50;
            for (let i = 0; i < recordsToUpdate.length; i += chunkSize) {
                const chunk = recordsToUpdate.slice(i, i + chunkSize);
                const placeholders = chunk
                    .map((_, idx) => {
                        const start = idx * 13 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11}, $${start + 12})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const record of chunk) {
                    const b = recordToBindings(record);
                    values.push(
                        b.id,
                        b.scopeType,
                        b.scopeId,
                        b.roomId,
                        b.chatId,
                        b.messageId,
                        b.sortOrder,
                        b.ownerId,
                        b.createdAt,
                        b.updatedAt,
                        b.isDeleted,
                        b.assetEntries,
                        b.data
                    );
                }
                await db.execute(
                    `INSERT OR REPLACE INTO ${tableName}
	                (id, scopeType, scopeId, roomId, chatId, messageId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, assetEntries, data)
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
            `UPDATE ${tableName} SET isDeleted = 1, updatedAt = $3, assetEntries = NULL, data = '{}' WHERE ${col1} = $1 AND ${col2} = $2 AND isDeleted = 0`,
            [indexValue[0], indexValue[1], now]
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

    async getUnsyncedChanges<T extends DataRecord>(
        tableName: TableName,
        scope: DataScope,
        sinceUpdatedAt: number
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE scopeType = $1 AND scopeId = $2 AND updatedAt >= $3`,
            [scope.scopeType, scope.scopeId, sinceUpdatedAt]
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
