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

export interface AsyncCacheStore<T> {
    get(key: string): Promise<T | undefined>;
    getMany(keys: string[]): Promise<Map<string, T>>;
    set(key: string, value: T): Promise<void>;
    setMany(entries: ReadonlyArray<readonly [string, T]>): Promise<void>;
    delete(key: string): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}

export interface CacheEntry {
    key: string;
    value: unknown;
}

export interface CacheBackend {
    loadAll(namespace: string): Promise<CacheEntry[]>;
    sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void>;
    getMany(namespace: string, keys: string[]): Promise<CacheEntry[]>;
    setMany(namespace: string, entries: CacheEntry[], capacity: number): Promise<void>;
    deleteMany(namespace: string, keys: string[]): Promise<void>;
    /** Queue read-recency touches in memory. Must not write synchronously. Returns true when a flush is worthwhile. */
    queueTouch(namespace: string, keys: string[]): boolean;
    /** Persist queued touches as one batched update. Never upserts, so racing deletes stay dead. */
    flushTouches(): Promise<void>;
}
