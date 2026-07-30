import Database from '@tauri-apps/plugin-sql';
import type { CacheBackend, CacheEntry } from './types';
import { Mutex } from '$lib/utils/mutex';

const CHUNK_SIZE = 50;

interface CacheRow {
    key: string;
    value: string | null;
}

let lastAccessedAt = Date.now();

function nextAccessedAt(): number {
    lastAccessedAt = Math.max(Date.now(), lastAccessedAt + 1);
    return lastAccessedAt;
}

/**
 * Tauri SQLite Cache Backend
 *
 * Uses @tauri-apps/plugin-sql with a separate DB file (KeiCacheDB.db) so
 * cache data never mixes with domain records (KeiLocalDB.db) and is never
 * synced. Values are stored as JSON-serializable TEXT.
 */
export class TauriCacheBackend implements CacheBackend {
    private dbPromise: Promise<Database> | null = null;
    private readonly mutex = new Mutex();

    private async getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = (async () => {
            const db = await Database.load('sqlite:KeiCacheDB.db');
            await db.execute(`
                CREATE TABLE IF NOT EXISTS entries (
                    nskey TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT,
                    accessed_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_entries_namespace ON entries (namespace);
                CREATE INDEX IF NOT EXISTS idx_entries_namespace_accessed
                    ON entries (namespace, accessed_at);
            `);
            return db;
        })();
        return this.dbPromise;
    }

    private async runExclusive<T>(operation: (db: Database) => Promise<T>): Promise<T> {
        const db = await this.getDb();
        return this.mutex.runExclusive(() => operation(db));
    }

    private async transaction<T>(operation: (db: Database) => Promise<T>): Promise<T> {
        return this.runExclusive(async (db) => {
            await db.execute('BEGIN TRANSACTION');
            try {
                const result = await operation(db);
                await db.execute('COMMIT');
                return result;
            } catch (error) {
                await db.execute('ROLLBACK');
                throw error;
            }
        });
    }

    async loadAll(namespace: string): Promise<CacheEntry[]> {
        return this.runExclusive(async (db) => {
            const rows = await db.select<CacheRow[]>(
                'SELECT key, value FROM entries WHERE namespace = $1 ORDER BY accessed_at ASC, nskey ASC',
                [namespace]
            );
            return rows.map(({ key, value }) => ({
                key,
                value: value !== null ? JSON.parse(value) : null
            }));
        });
    }

    async sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void> {
        if (puts.length === 0 && deletes.length === 0) return;
        const accessedAt = nextAccessedAt();

        await this.transaction(async (db) => {
            for (let i = 0; i < puts.length; i += CHUNK_SIZE) {
                const chunk = puts.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk
                    .map((_, idx) => {
                        const start = idx * 5 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const { key, value } of chunk) {
                    values.push(
                        `${namespace}:${key}`,
                        namespace,
                        key,
                        JSON.stringify(value),
                        accessedAt
                    );
                }
                await db.execute(
                    `INSERT OR REPLACE INTO entries (nskey, namespace, key, value, accessed_at) VALUES ${placeholders}`,
                    values
                );
            }

            for (let i = 0; i < deletes.length; i += CHUNK_SIZE) {
                const chunk = deletes.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(', ');
                const nskeys = chunk.map((key) => `${namespace}:${key}`);
                await db.execute(`DELETE FROM entries WHERE nskey IN (${placeholders})`, nskeys);
            }
        });
    }

    async getMany(namespace: string, keys: string[]): Promise<CacheEntry[]> {
        if (keys.length === 0) return [];
        const uniqueKeys = [...new Set(keys)];
        const accessedAt = nextAccessedAt();

        return this.transaction(async (db) => {
            const rows: CacheRow[] = [];
            for (let index = 0; index < uniqueKeys.length; index += CHUNK_SIZE) {
                const chunk = uniqueKeys.slice(index, index + CHUNK_SIZE);
                const nskeys = chunk.map((key) => `${namespace}:${key}`);
                const placeholders = nskeys.map((_, itemIndex) => `$${itemIndex + 1}`).join(', ');
                rows.push(
                    ...(await db.select<CacheRow[]>(
                        `SELECT key, value FROM entries WHERE nskey IN (${placeholders})`,
                        nskeys
                    ))
                );
                await db.execute(
                    `UPDATE entries SET accessed_at = $1 WHERE nskey IN (${nskeys
                        .map((_, itemIndex) => `$${itemIndex + 2}`)
                        .join(', ')})`,
                    [accessedAt, ...nskeys]
                );
            }
            return rows.map(({ key, value }) => ({
                key,
                value: value !== null ? JSON.parse(value) : null
            }));
        });
    }

    async setMany(namespace: string, entries: CacheEntry[], capacity: number): Promise<void> {
        if (entries.length === 0) return;
        const uniqueEntries = [...new Map(entries.map((entry) => [entry.key, entry.value]))];

        await this.transaction(async (db) => {
            for (let index = 0; index < uniqueEntries.length; index += CHUNK_SIZE) {
                const chunk = uniqueEntries.slice(index, index + CHUNK_SIZE);
                const placeholders = chunk
                    .map((_, itemIndex) => {
                        const start = itemIndex * 5 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const [key, value] of chunk) {
                    values.push(
                        `${namespace}:${key}`,
                        namespace,
                        key,
                        JSON.stringify(value),
                        nextAccessedAt()
                    );
                }
                await db.execute(
                    `INSERT OR REPLACE INTO entries (nskey, namespace, key, value, accessed_at) VALUES ${placeholders}`,
                    values
                );
            }

            await db.execute(
                `DELETE FROM entries
                 WHERE nskey IN (
                     SELECT nskey FROM entries
                     WHERE namespace = $1
                     ORDER BY accessed_at DESC, nskey DESC
                     LIMIT -1 OFFSET $2
                )`,
                [namespace, capacity]
            );
        });
    }

    async deleteMany(namespace: string, keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        const uniqueKeys = [...new Set(keys)];
        await this.runExclusive(async (db) => {
            for (let index = 0; index < uniqueKeys.length; index += CHUNK_SIZE) {
                const chunk = uniqueKeys.slice(index, index + CHUNK_SIZE);
                const nskeys = chunk.map((key) => `${namespace}:${key}`);
                const placeholders = nskeys.map((_, itemIndex) => `$${itemIndex + 1}`).join(', ');
                await db.execute(`DELETE FROM entries WHERE nskey IN (${placeholders})`, nskeys);
            }
        });
    }
}
