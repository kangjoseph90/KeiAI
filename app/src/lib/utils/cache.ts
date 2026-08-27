/**
 * Shared Cache Utilities — KeiAI
 *
 * Common cache implementations used across the application.
 */

interface LRUCacheOptions<V> {
    /** Turns maxSize into a budget of estimateSize units instead of a count. */
    estimateSize?: (value: V) => number;
}

/**
 * Simple LRU cache. Limit is an entry count, or a total-size budget when
 * `estimateSize` is given. A lone oversized value is kept rather than rejected.
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, number>(100);
 * cache.set('key', 42);
 * const value = cache.get('key'); // 42
 * ```
 */
export class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private readonly maxSize: number;
    private readonly estimateSize?: (value: V) => number;
    private currentBudget = 0;

    constructor(maxSize = 100, options?: LRUCacheOptions<V>) {
        this.maxSize = maxSize;
        this.estimateSize = options?.estimateSize;
    }

    private sizeOf(value: V): number {
        return this.estimateSize ? this.estimateSize(value) : 1;
    }

    /**
     * Get value from cache.
     * If found, moves the entry to the end (most recently used).
     */
    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    /**
     * Set value in cache.
     * If over budget, evicts least recently used entries first until it fits.
     */
    set(key: K, value: V): void {
        const incomingSize = this.sizeOf(value);
        const existing = this.cache.get(key);
        if (existing !== undefined) {
            this.currentBudget -= this.sizeOf(existing);
            this.cache.delete(key);
        } else if (this.estimateSize) {
            while (this.cache.size > 0 && this.currentBudget + incomingSize > this.maxSize) {
                this.evictOldest();
            }
        } else if (this.cache.size >= this.maxSize) {
            this.evictOldest();
        }
        this.currentBudget += incomingSize;
        this.cache.set(key, value);
    }

    private evictOldest(): void {
        const firstEntry = this.cache.entries().next();
        if (firstEntry.done) return;
        this.currentBudget -= this.sizeOf(firstEntry.value[1]);
        this.cache.delete(firstEntry.value[0]);
    }

    /**
     * Check if a key exists in the cache.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete a specific key from the cache.
     */
    delete(key: K): boolean {
        const existing = this.cache.get(key);
        if (existing === undefined) return false;
        this.currentBudget -= this.sizeOf(existing);
        this.cache.delete(key);
        return true;
    }

    /**
     * Clear all entries from the cache.
     */
    clear(): void {
        this.cache.clear();
        this.currentBudget = 0;
    }

    /**
     * Get the current number of entries in the cache.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get all keys in the cache (ordered by least to most recently used).
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * Get all values in the cache (ordered by least to most recently used).
     */
    values(): IterableIterator<V> {
        return this.cache.values();
    }

    /**
     * Get all entries in the cache (ordered by least to most recently used).
     */
    entries(): IterableIterator<[K, V]> {
        return this.cache.entries();
    }
}
