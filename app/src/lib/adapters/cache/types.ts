/**
 * Cache Adapter Types — KeiAI
 *
 * Generic local-only LRU cache with IndexedDB persistence.
 * Uses LRUCache from utils/cache.ts for in-memory eviction.
 */

export interface CacheStore<T> {
    /** Get a cached value by key. Returns undefined if not found. */
    get(key: string): T | undefined;

    /** Set a cached value. Triggers debounced flush to IndexedDB. */
    set(key: string, value: T): void;

    /** Delete a cached value. Triggers debounced flush to IndexedDB. */
    delete(key: string): void;

    /** Flush all in-memory entries to IndexedDB. */
    flush(): Promise<void>;
}
