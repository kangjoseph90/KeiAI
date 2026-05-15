/**
 * Cache Adapter — KeiAI
 *
 * Generic local-only LRU cache backed by IndexedDB.
 * Reuses LRUCache from utils/cache.ts for in-memory eviction.
 * Separate Dexie instance (KeiCacheDB) so cache data never
 * mixes with domain records and is never synced.
 */

import Dexie, { type Table } from 'dexie';
import { LRUCache } from '$lib/utils/cache';
import type { CacheStore } from './types';

export type { CacheStore } from './types';

// ─── Dexie Schema ──────────────────────────────────────────────────

interface CacheRecord {
    nskey: string; // compound key: `${namespace}:${key}`
    namespace: string;
    key: string;
    value: unknown;
}

class CacheDB extends Dexie {
    entries!: Table<CacheRecord, string>;

    constructor() {
        super('KeiCacheDB');
        this.version(1).stores({
            entries: 'nskey, namespace'
        });
    }
}

const db = new CacheDB();

// ─── Factory ───────────────────────────────────────────────────────

export function createCache<T>(namespace: string, capacity: number): CacheStore<T> {
    const lru = new LRUCache<string, T>(capacity);
    let dirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_DELAY_MS = 1000;

    // Auto-load: starts immediately, flush awaits completion to avoid data loss
    const loadPromise: Promise<void> = (async () => {
        const records = await db.entries.where('namespace').equals(namespace).toArray();
        for (const record of records) {
            if (!lru.has(record.key)) {
                lru.set(record.key, record.value as T);
            }
        }
    })();

    function scheduleFlush(): void {
        if (flushTimer !== null) return;
        dirty = true;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flush();
        }, FLUSH_DELAY_MS);
    }

    async function flush(): Promise<void> {
        await loadPromise;
        if (!dirty) return;
        dirty = false;
        const entries: CacheRecord[] = [];
        for (const [key, value] of lru.entries()) {
            entries.push({
                nskey: `${namespace}:${key}`,
                namespace,
                key,
                value
            });
        }
        await db.transaction('rw', db.entries, async () => {
            await db.entries.where('namespace').equals(namespace).delete();
            await db.entries.bulkPut(entries);
        });
    }

    return {
        get(key: string): T | undefined {
            return lru.get(key);
        },

        set(key: string, value: T): void {
            lru.set(key, value);
            scheduleFlush();
        },

        delete(key: string): void {
            lru.delete(key);
            scheduleFlush();
        },

        flush
    };
}
