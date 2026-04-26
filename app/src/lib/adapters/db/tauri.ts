import Database from '@tauri-apps/plugin-sql';
import type {
    IDatabaseAdapter,
    TableName,
    BaseRecord,
    DatabaseWriteEventListener,
    DatabaseWriteOptions
} from './types';
import { TABLES } from './types';
import { AppError } from '$lib/types/errors';
import { DatabaseWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';

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
    userId: string | null;
    characterId: string | null;
    chatId: string | null;
    messageId: string | null;
    swipeId: string | null;
    sortOrder: string | null;
    ownerId: string | null;
    createdAt: number | null;
    updatedAt: number | null;
    isDeleted: number; // 0 | 1
    data: string; // JSON.stringify(...)
}

interface RecordBindingShape {
    id: string;
    userId?: string;
    updatedAt?: number;
    isDeleted?: boolean;
    characterId?: string;
    chatId?: string;
    messageId?: string;
    swipeId?: string;
    sortOrder?: string;
    ownerId?: string;
    createdAt?: number;
    data?: Record<string, unknown>;
}

// Convert record to DB row bindings safely
function recordToBindings<T extends BaseRecord>(record: T): DatabaseSqlRow {
    const clone: RecordBindingShape = { ...record };

    const bindings: DatabaseSqlRow = {
        id: clone.id,
        userId: clone.userId ?? null,
        characterId: clone.characterId ?? null,
        chatId: clone.chatId ?? null,
        messageId: clone.messageId ?? null,
        swipeId: clone.swipeId ?? null,
        sortOrder: clone.sortOrder ?? null,
        ownerId: clone.ownerId ?? null,
        createdAt: clone.createdAt ?? null,
        updatedAt: clone.updatedAt ?? null,
        isDeleted: clone.isDeleted ? 1 : 0,
        data: JSON.stringify(clone.data ?? {})
    };

    return bindings;
}

function parseRecord<T>(row: DatabaseSqlRow): T {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
        id: row.id,
        userId: row.userId ?? '',
        characterId: row.characterId ?? undefined,
        chatId: row.chatId ?? undefined,
        messageId: row.messageId ?? undefined,
        swipeId: row.swipeId ?? undefined,
        sortOrder: row.sortOrder ?? undefined,
        ownerId: row.ownerId ?? undefined,
        createdAt: row.createdAt ?? 0,
        updatedAt: row.updatedAt ?? 0,
        isDeleted: row.isDeleted === 1,
        data
    } as T;
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
						userId TEXT,
						characterId TEXT,
						chatId TEXT,
						messageId TEXT,
						swipeId TEXT,
                        sortOrder TEXT,
                        ownerId TEXT,
                        createdAt INTEGER,
                        updatedAt INTEGER,
                        isDeleted INTEGER,
                        data TEXT
					);
				`;

            // Common indices used securely for lookup and sync
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_userId" ON "${table}" (userId);
`;
            sql += `CREATE INDEX IF NOT EXISTS "idx_${table}_updatedAt" ON "${table}" (updatedAt);
`;
        }

        // FK indices for 1:N parent→child queries
        sql += `CREATE INDEX IF NOT EXISTS "idx_chats_characterId" ON chats (characterId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_lorebooks_ownerId" ON lorebooks (ownerId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_scripts_ownerId" ON scripts (ownerId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_charjs_ownerId" ON charjs (ownerId);
`;

        // Compound index strictly required for pagination performance in messages
        sql += `CREATE INDEX IF NOT EXISTS "idx_messages_chatId_sortOrder" ON messages (chatId, sortOrder);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_chatId" ON tool_calls (chatId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_messageId" ON tool_calls (messageId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_swipeId" ON tool_calls (swipeId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_tool_calls_messageId_swipeId" ON tool_calls (messageId, swipeId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_chatId" ON translations (chatId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_messageId" ON translations (messageId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_swipeId" ON translations (swipeId);
`;
        sql += `CREATE INDEX IF NOT EXISTS "idx_translations_messageId_swipeId" ON translations (messageId, swipeId);
        `;

        await db.execute(sql);
    }

    async getRecord<T extends BaseRecord>(
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

    async putRecord<T extends BaseRecord>(
        tableName: TableName,
        record: T,
        options?: DatabaseWriteOptions
    ): Promise<void> {
        const db = await this.getDb();
        const b = recordToBindings(record);
        await db.execute(
            `INSERT OR REPLACE INTO ${tableName}
				(id, userId, characterId, chatId, messageId, swipeId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, data)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                b.id,
                b.userId,
                b.characterId,
                b.chatId,
                b.messageId,
                b.swipeId,
                b.sortOrder,
                b.ownerId,
                b.createdAt,
                b.updatedAt,
                b.isDeleted,
                b.data
            ]
        );
        this.emitWriteEvent(tableName, 'put', [record.id], options);
    }

    async putRecords<T extends BaseRecord>(
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
                    const start = idx * 12 + 1;
                    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11})`;
                })
                .join(', ');

            const values: unknown[] = [];
            for (const record of chunk) {
                const b = recordToBindings(record);
                values.push(
                    b.id,
                    b.userId,
                    b.characterId,
                    b.chatId,
                    b.messageId,
                    b.swipeId,
                    b.sortOrder,
                    b.ownerId,
                    b.createdAt,
                    b.updatedAt,
                    b.isDeleted,
                    b.data
                );
            }

            await db.execute(
                `INSERT OR REPLACE INTO ${tableName}
					(id, userId, characterId, chatId, messageId, swipeId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, data)
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
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE ${indexName} = $1`,
            [indexValue]
        );
        const now = clock.now();
        const recordsToUpdate: BaseRecord[] = [];

        for (const row of rows) {
            const record = parseRecord<BaseRecord>(row);
            record.isDeleted = true;
            record.updatedAt = now;
            recordsToUpdate.push(record);
        }

        if (recordsToUpdate.length > 0) {
            const chunkSize = 50;
            for (let i = 0; i < recordsToUpdate.length; i += chunkSize) {
                const chunk = recordsToUpdate.slice(i, i + chunkSize);
                const placeholders = chunk
                    .map((_, idx) => {
                        const start = idx * 12 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const record of chunk) {
                    const b = recordToBindings(record);
                    values.push(
                        b.id,
                        b.userId,
                        b.characterId,
                        b.chatId,
                        b.messageId,
                        b.swipeId,
                        b.sortOrder,
                        b.ownerId,
                        b.createdAt,
                        b.updatedAt,
                        b.isDeleted,
                        b.data
                    );
                }
                await db.execute(
                    `INSERT OR REPLACE INTO ${tableName}
	                (id, userId, characterId, chatId, messageId, swipeId, sortOrder, ownerId, createdAt, updatedAt, isDeleted, data)
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

    async getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE userId = $1 AND isDeleted = 0 ORDER BY updatedAt DESC`,
            [userId]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async getByIndex<T extends BaseRecord>(
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

    async getRecordsBackward<T extends BaseRecord>(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit: number = 50,
        offset: number = 0
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();

        const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
        if (isComposite) {
            const cols = indexName.slice(1, -1).split('+');
            if (cols.length === 2) {
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
        }

        throw new AppError(
            'INVALID_INPUT',
            `Unsupported indexName for getRecordsBackward: ${indexName}`
        );
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
        const db = await this.getDb();

        const isComposite = indexName.startsWith('[') && indexName.endsWith(']');
        if (isComposite) {
            const cols = indexName.slice(1, -1).split('+');
            if (cols.length === 2) {
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
        }

        throw new AppError(
            'INVALID_INPUT',
            `Unsupported indexName for getRecordsForward: ${indexName}`
        );
    }

    async getUnsyncedChanges<T extends BaseRecord>(
        tableName: TableName,
        userId: string,
        sinceUpdatedAt: number
    ): Promise<T[]> {
        await this.flush();
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT * FROM ${tableName} WHERE userId = $1 AND updatedAt >= $2`,
            [userId, sinceUpdatedAt]
        );
        return rows.map((row) => parseRecord<T>(row));
    }

    async transaction<R>(
        _tables: TableName[],
        _mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R> {
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
        operation:
            | 'put'
            | 'putMany'
            | 'delete'
            | 'deleteByIndex'
            | 'softDelete'
            | 'softDeleteByIndex',
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
