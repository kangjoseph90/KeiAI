import Database from '@tauri-apps/plugin-sql';
import type { CacheBackend, CacheEntry } from './types';
import { decodeCacheValue, encodeCacheValue } from './float-codec';
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

const pendingTouches = new Map<string, Set<string>>();
let touchFlushChain: Promise<void> = Promise.resolve();
const TOUCH_FLUSH_THRESHOLD = 256;

/**
 * Tauri SQLite Cache Backend.
 *
 * Separate DB file (KeiCacheDB.db) so cache data never mixes with domain
 * records and is never synced. Rows are identified by (namespace, key) and
 * values live in TEXT encoded by float-codec.ts: base64 little-endian
 * Float32 for typed arrays, JSON for everything else.
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
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT,
                    accessed_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (namespace, key)
                );
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
                'SELECT key, value FROM entries WHERE namespace = $1 ORDER BY accessed_at ASC, key ASC',
                [namespace]
            );
            return rows.map(({ key, value }) => ({
                key,
                value: decodeCacheValue(value)
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
                        const start = idx * 4 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const { key, value } of chunk) {
                    values.push(namespace, key, encodeCacheValue(value), accessedAt);
                }
                await db.execute(
                    `INSERT OR REPLACE INTO entries (namespace, key, value, accessed_at) VALUES ${placeholders}`,
                    values
                );
            }

            for (let i = 0; i < deletes.length; i += CHUNK_SIZE) {
                const chunk = deletes.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map((_, idx) => `$${idx + 2}`).join(', ');
                await db.execute(
                    `DELETE FROM entries WHERE namespace = $1 AND key IN (${placeholders})`,
                    [namespace, ...chunk]
                );
            }
        });
    }

    async getMany(namespace: string, keys: string[]): Promise<CacheEntry[]> {
        if (keys.length === 0) return [];
        const uniqueKeys = [...new Set(keys)];

        return this.runExclusive(async (db) => {
            const rows: CacheRow[] = [];
            for (let index = 0; index < uniqueKeys.length; index += CHUNK_SIZE) {
                const chunk = uniqueKeys.slice(index, index + CHUNK_SIZE);
                const placeholders = chunk.map((_, itemIndex) => `$${itemIndex + 2}`).join(', ');
                rows.push(
                    ...(await db.select<CacheRow[]>(
                        `SELECT key, value FROM entries WHERE namespace = $1 AND key IN (${placeholders})`,
                        [namespace, ...chunk]
                    ))
                );
            }
            return rows.map(({ key, value }) => ({ key, value: decodeCacheValue(value) }));
        });
    }

    queueTouch(namespace: string, keys: string[]): boolean {
        let pending = pendingTouches.get(namespace);
        if (!pending) {
            pending = new Set();
            pendingTouches.set(namespace, pending);
        }
        for (const key of keys) pending.add(key);
        return pending.size >= TOUCH_FLUSH_THRESHOLD;
    }

    flushTouches(): Promise<void> {
        const run = touchFlushChain.then(async () => {
            if (pendingTouches.size === 0) return;
            const snapshots = [...pendingTouches].map(([namespace, keys]) => ({
                namespace,
                keys: [...keys]
            }));
            pendingTouches.clear();
            const accessedAt = nextAccessedAt();

            await this.runExclusive(async (db) => {
                for (const { namespace, keys } of snapshots) {
                    for (let index = 0; index < keys.length; index += CHUNK_SIZE) {
                        const chunk = keys.slice(index, index + CHUNK_SIZE);
                        const placeholders = chunk
                            .map((_, itemIndex) => `$${itemIndex + 3}`)
                            .join(', ');
                        await db.execute(
                            `UPDATE entries SET accessed_at = $1
                             WHERE namespace = $2 AND key IN (${placeholders})`,
                            [accessedAt, namespace, ...chunk]
                        );
                    }
                }
            });
        });
        touchFlushChain = run.catch(() => undefined);
        return run;
    }

    async setMany(namespace: string, entries: CacheEntry[], capacity: number): Promise<void> {
        if (entries.length === 0) return;
        const uniqueEntries = [...new Map(entries.map((entry) => [entry.key, entry.value]))];

        await this.transaction(async (db) => {
            for (let index = 0; index < uniqueEntries.length; index += CHUNK_SIZE) {
                const chunk = uniqueEntries.slice(index, index + CHUNK_SIZE);
                const placeholders = chunk
                    .map((_, itemIndex) => {
                        const start = itemIndex * 4 + 1;
                        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3})`;
                    })
                    .join(', ');
                const values: unknown[] = [];
                for (const [key, value] of chunk) {
                    values.push(namespace, key, encodeCacheValue(value), nextAccessedAt());
                }
                await db.execute(
                    `INSERT OR REPLACE INTO entries (namespace, key, value, accessed_at) VALUES ${placeholders}`,
                    values
                );
            }

            await db.execute(
                `DELETE FROM entries
                 WHERE namespace = $1
                   AND key IN (
                     SELECT key FROM entries
                     WHERE namespace = $1
                     ORDER BY accessed_at DESC, key DESC
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
                const placeholders = chunk.map((_, itemIndex) => `$${itemIndex + 2}`).join(', ');
                await db.execute(
                    `DELETE FROM entries WHERE namespace = $1 AND key IN (${placeholders})`,
                    [namespace, ...chunk]
                );
            }
        });
    }
}
