/**
 * Cache Adapter — KeiAI
 *
 * Generic local-only LRU cache backed by IndexedDB.
 * Reuses LRUCache from utils/cache.ts for in-memory eviction.
 * Separate Dexie instance (KeiCacheDB) so cache data never
 * mixes with domain records and is never synced.
 */

import { isTauri } from '@tauri-apps/api/core';
import { LRUCache } from '$lib/utils/cache';
import { WebCacheBackend } from './web';
import { TauriCacheBackend } from './tauri';
import type { CacheBackend, CacheEntry, CacheStore } from './types';

export type { CacheStore } from './types';

const backend: CacheBackend = isTauri() ? new TauriCacheBackend() : new WebCacheBackend();

export function createCache<T>(namespace: string, capacity: number): CacheStore<T> {
    const lru = new LRUCache<string, T>(capacity);
    const pendingWrites = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_DELAY_MS = 1000;

    const loadPromise: Promise<void> = (async () => {
        const entries = await backend.loadAll(namespace);
        for (const { key, value } of entries) {
            if (!lru.has(key)) {
                lru.set(key, value as T);
            }
        }
    })();

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
