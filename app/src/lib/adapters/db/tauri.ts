import Database from '@tauri-apps/plugin-sql';
import { fromBase64, toBase64 } from '$lib/crypto/encoding';
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

/**
 * Tauri SQLite Local Database Adapter
 *
 * Uses @tauri-apps/plugin-sql.
 * Creates a unified row structure for all tables containing:
 *  - Primary `id`
 *  - Commonly indexed string/number columns
 *  - `data` column: JSON.stringified raw object payload
 *
 * `Uint8Array` properties are temporarily converted to base64 strings
 * during JSON.stringify to survive SQLite TEXT column storage, and converted
 * back upon reading.
 */

/** Raw shape of a database record as stored in SQLite */
interface DatabaseSqlRow {
    id: string;
    userId: string | null;
    characterId: string | null;
    chatId: string | null;
    sortOrder: string | null;
    ownerId: string | null;
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
    sortOrder?: string;
    ownerId?: string;
    encryptedData?: Uint8Array<ArrayBufferLike> | string;
    encryptedDataIV?: Uint8Array<ArrayBufferLike> | string;
}

// Convert record to DB row bindings safely
function recordToBindings<T extends BaseRecord>(record: T): DatabaseSqlRow {
    const clone: RecordBindingShape = { ...record };

    const bindings: DatabaseSqlRow = {
        id: clone.id,
        userId: clone.userId ?? null,
        characterId: clone.characterId ?? null,
        chatId: clone.chatId ?? null,
        sortOrder: clone.sortOrder ?? null,
        ownerId: clone.ownerId ?? null,
        updatedAt: clone.updatedAt ?? null,
        isDeleted: clone.isDeleted ? 1 : 0,
        data: '' // placeholder
    };

    if (clone.encryptedData instanceof Uint8Array) {
        clone.encryptedData = toBase64(clone.encryptedData as Uint8Array<ArrayBuffer>);
    }
    if (clone.encryptedDataIV instanceof Uint8Array) {
        clone.encryptedDataIV = toBase64(clone.encryptedDataIV as Uint8Array<ArrayBuffer>);
    }

    bindings.data = JSON.stringify(clone);
    return bindings;
}

function parseRecord<T>(row: DatabaseSqlRow): T {
    const obj = JSON.parse(row.data);
    if (typeof obj.encryptedData === 'string') {
        obj.encryptedData = fromBase64(obj.encryptedData);
    }
    if (typeof obj.encryptedDataIV === 'string') {
        obj.encryptedDataIV = fromBase64(obj.encryptedDataIV);
    }
    return obj as T;
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
        for (const table of TABLES) {
            await db.execute(`
				CREATE TABLE IF NOT EXISTS ${table} (
					id TEXT PRIMARY KEY,
					userId TEXT,
					characterId TEXT,
					chatId TEXT,
					sortOrder TEXT,
					ownerId TEXT,
					updatedAt INTEGER,
					isDeleted INTEGER,
					data TEXT
				)
			`);

            // Common indices used securely for lookup and sync
            await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_userId ON ${table} (userId)`);
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_${table}_updatedAt ON ${table} (updatedAt)`
            );
        }

        // FK indices for 1:N parent→child queries
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_chats_characterId ON chats (characterId)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_lorebooks_ownerId ON lorebooks (ownerId)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_scripts_ownerId ON scripts (ownerId)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_charjs_ownerId ON charjs (ownerId)`);

        // Compound index strictly required for pagination performance in messages
        await db.execute(
            `CREATE INDEX IF NOT EXISTS idx_messages_chatId_sortOrder ON messages (chatId, sortOrder)`
        );
    }

    async getRecord<T extends BaseRecord>(
        tableName: TableName,
        id: string
    ): Promise<T | undefined> {
        const db = await this.getDb();
        const rows = await db.select<DatabaseSqlRow[]>(
            `SELECT data FROM ${tableName} WHERE id = $1`,
            [id]
        );
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
			(id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data) 
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                b.id,
                b.userId,
                b.characterId,
                b.chatId,
                b.sortOrder,
                b.ownerId,
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
                    const start = idx * 9 + 1;
                    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
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
                    b.sortOrder,
                    b.ownerId,
                    b.updatedAt,
                    b.isDeleted,
                    b.data
                );
            }

            await db.execute(
                `INSERT OR REPLACE INTO ${tableName} 
				(id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data) 
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
            record.updatedAt = Date.now();
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
            `SELECT data FROM ${tableName} WHERE ${indexName} = $1`,
            [indexValue]
        );
        const now = Date.now();
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
                        const start = idx * 9 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8})`;
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
                        b.sortOrder,
                        b.ownerId,
                        b.updatedAt,
                        b.isDeleted,
                        b.data
                    );
                }
                await db.execute(
                    `INSERT OR REPLACE INTO ${tableName}
                (id, userId, characterId, chatId, sortOrder, ownerId, updatedAt, isDeleted, data)
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
            `SELECT data FROM ${tableName} WHERE userId = $1 AND isDeleted = 0 ORDER BY updatedAt DESC`,
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
            `SELECT data FROM ${tableName} WHERE ${indexName} = $1 AND isDeleted = 0 LIMIT $2 OFFSET $3`,
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

                const query = `SELECT data FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} DESC LIMIT $4 OFFSET $5`;
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

                const query = `SELECT data FROM ${tableName} WHERE ${col1} = $1 AND ${col2} > $2 AND ${col2} < $3 AND isDeleted = 0 ORDER BY ${col2} ASC LIMIT $4 OFFSET $5`;
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
            `SELECT data FROM ${tableName} WHERE userId = $1 AND updatedAt >= $2`,
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
