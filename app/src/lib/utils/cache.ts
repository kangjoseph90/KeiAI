/**
 * Shared Cache Utilities — KeiAI
 *
 * Common cache implementations used across the application.
 */

/**
 * Simple LRU (Least Recently Used) cache implementation.
 * Entries are evicted in FIFO order when the cache is full.
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

	constructor(maxSize = 100) {
		this.maxSize = maxSize;
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
	 * If full, evicts the least recently used entry first.
	 */
	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Remove first (least recently used)
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}
		this.cache.set(key, value);
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
		return this.cache.delete(key);
	}

	/**
	 * Clear all entries from the cache.
	 */
	clear(): void {
		this.cache.clear();
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
