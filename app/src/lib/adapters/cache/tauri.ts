import Database from '@tauri-apps/plugin-sql';
import type { CacheBackend, CacheEntry } from './types';

const CHUNK_SIZE = 50;

interface CacheRow {
    key: string;
    value: string | null;
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

    private async getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = (async () => {
            const db = await Database.load('sqlite:KeiCacheDB.db');
            await db.execute(`
                CREATE TABLE IF NOT EXISTS entries (
                    nskey TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_entries_namespace ON entries (namespace);
            `);
            return db;
        })();
        return this.dbPromise;
    }

    async loadAll(namespace: string): Promise<CacheEntry[]> {
        const db = await this.getDb();
        const rows = await db.select<CacheRow[]>(
            'SELECT key, value FROM entries WHERE namespace = $1',
            [namespace]
        );
        return rows.map(({ key, value }) => ({
            key,
            value: value !== null ? JSON.parse(value) : null
        }));
    }

    async sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void> {
        if (puts.length === 0 && deletes.length === 0) return;
        const db = await this.getDb();

        await db.execute('BEGIN TRANSACTION');
        try {
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
                    values.push(`${namespace}:${key}`, namespace, key, JSON.stringify(value));
                }
                await db.execute(
                    `INSERT OR REPLACE INTO entries (nskey, namespace, key, value) VALUES ${placeholders}`,
                    values
                );
            }

            for (let i = 0; i < deletes.length; i += CHUNK_SIZE) {
                const chunk = deletes.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(', ');
                const nskeys = chunk.map((key) => `${namespace}:${key}`);
                await db.execute(`DELETE FROM entries WHERE nskey IN (${placeholders})`, nskeys);
            }

            await db.execute('COMMIT');
        } catch (error) {
            await db.execute('ROLLBACK');
            throw error;
        }
    }
}
