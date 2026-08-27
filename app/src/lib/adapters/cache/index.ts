/**
 * Cache Adapter — KeiAI
 *
 * Local-only caches backed by IndexedDB or SQLite.
 * createCache() eagerly hydrates an in-memory LRU for synchronous access.
 * createAsyncCache() reads and writes requested keys directly in persistent storage.
 * Separate Dexie instance (KeiCacheDB) so cache data never
 * mixes with domain records and is never synced.
 */

import { isTauri } from '@tauri-apps/api/core';
import { LRUCache } from '$lib/utils/cache';
import { WebCacheBackend } from './web';
import { TauriCacheBackend } from './tauri';
import type { AsyncCacheStore, CacheBackend, CacheEntry, CacheStore } from './types';

export type { AsyncCacheStore, CacheStore } from './types';

const backend: CacheBackend = isTauri() ? new TauriCacheBackend() : new WebCacheBackend();

export function createAsyncCache<T>(namespace: string, capacity: number): AsyncCacheStore<T> {
    /** Persists queued touches before mutations so eviction sees fresh recency. */
    async function drainTouches(): Promise<void> {
        try {
            await backend.flushTouches();
        } catch {
            // Touch bookkeeping is best-effort; a failed flush must not fail
            // the operation it precedes.
        }
    }

    function trackTouches(entries: CacheEntry[]): void {
        if (entries.length === 0) return;
        const hitKeys = entries.map((entry) => entry.key);
        if (backend.queueTouch(namespace, hitKeys)) {
            void backend.flushTouches().catch(() => undefined);
        }
    }

    return {
        async get(key: string): Promise<T | undefined> {
            const entries = await backend.getMany(namespace, [key]);
            trackTouches(entries);
            return entries[0]?.value as T | undefined;
        },

        async getMany(keys: string[]): Promise<Map<string, T>> {
            const entries = await backend.getMany(namespace, keys);
            trackTouches(entries);
            return new Map(entries.map(({ key, value }) => [key, value as T]));
        },

        async set(key: string, value: T): Promise<void> {
            await drainTouches();
            await backend.setMany(namespace, [{ key, value }], capacity);
        },

        async setMany(entries: ReadonlyArray<readonly [string, T]>): Promise<void> {
            await drainTouches();
            await backend.setMany(
                namespace,
                entries.map(([key, value]) => ({ key, value })),
                capacity
            );
        },

        async delete(key: string): Promise<void> {
            await drainTouches();
            await backend.deleteMany(namespace, [key]);
        },

        async deleteMany(keys: string[]): Promise<void> {
            await drainTouches();
            await backend.deleteMany(namespace, keys);
        }
    };
}

export function createCache<T>(namespace: string, capacity: number): CacheStore<T> {
    const lru = new LRUCache<string, T>(capacity);
    const pendingWrites = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_DELAY_MS = 1000;

    const loadPromise: Promise<void> = (async () => {
        const entries = await backend.loadAll(namespace);
        for (const { key, value } of entries) {
            if (!lru.has(key)) {
                trackNextEviction(key);
                lru.set(key, value as T);
            }
        }
        if (pendingWrites.size > 0) scheduleFlush();
    })();

    function trackNextEviction(key: string): void {
        if (lru.has(key) || lru.size < capacity) return;
        const oldestKey = lru.keys().next().value;
        if (oldestKey !== undefined) pendingWrites.add(oldestKey);
    }

    function scheduleFlush(): void {
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flush();
        }, FLUSH_DELAY_MS);
    }

    async function flush(): Promise<void> {
        await loadPromise;
        if (pendingWrites.size === 0) return;

        const changed = new Set(pendingWrites);
        pendingWrites.clear();

        const toPut: CacheEntry[] = [];
        const toDelete: string[] = [];
        for (const key of changed) {
            if (lru.has(key)) {
                toPut.push({ key, value: lru.get(key) as T });
            } else {
                toDelete.push(key);
            }
        }

        await backend.sync(namespace, toPut, toDelete);
    }

    return {
        get(key: string): T | undefined {
            return lru.get(key);
        },

        set(key: string, value: T): void {
            trackNextEviction(key);
            lru.set(key, value);
            pendingWrites.add(key);
            scheduleFlush();
        },

        delete(key: string): void {
            lru.delete(key);
            pendingWrites.add(key);
            scheduleFlush();
        },

        flush
    };
}
