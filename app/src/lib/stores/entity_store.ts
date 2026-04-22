import type { Subscriber, Unsubscriber, Readable } from 'svelte/store';

export interface EntityStoreOptions<T> {
    sortFn?: (a: T, b: T) => number;
}

export class EntityStore<T extends { id: string }> implements Readable<T[]> {
    #map = new Map<string, T>();
    #subscribers = new Set<Subscriber<T[]>>();
    #sortFn: ((a: T, b: T) => number) | undefined;
    #batchDepth = 0;
    #dirty = false;
    #structChanged = true;
    #cachedArray: T[] | null = null;
    #sortedIds: string[] = [];

    constructor(options?: EntityStoreOptions<T>) {
        this.#sortFn = options?.sortFn;
    }

    // --- Readable<T[]> ---

    subscribe = (run: Subscriber<T[]>): Unsubscriber => {
        this.#subscribers.add(run);
        run(this.#resolveArray());
        return () => {
            this.#subscribers.delete(run);
        };
    };

    // --- O(1) Lookup ---

    get(id: string): T | undefined {
        return this.#map.get(id);
    }

    has(id: string): boolean {
        return this.#map.has(id);
    }

    get size(): number {
        return this.#map.size;
    }

    // --- Mutations ---

    setAll(items: T[]): void {
        this.#map.clear();
        for (const item of items) {
            this.#map.set(item.id, item);
        }
        this.#structChanged = true;
        this.#cachedArray = null;
        this.#flush();
    }

    set(id: string, item: T): void {
        const existing = this.#map.get(id);
        if (!existing) {
            this.#structChanged = true;
        } else if (this.#sortFn && this.#sortFn(existing, item) !== 0) {
            this.#structChanged = true;
        }
        this.#map.set(id, item);
        this.#cachedArray = null;
        this.#flush();
    }

    delete(id: string): boolean {
        if (this.#map.delete(id)) {
            this.#structChanged = true;
            this.#cachedArray = null;
            this.#flush();
            return true;
        }
        return false;
    }

    clear(): void {
        if (this.#map.size > 0) {
            this.#map.clear();
            this.#structChanged = true;
            this.#cachedArray = null;
            this.#flush();
        }
    }

    // --- Batching ---

    batch(fn: () => void): void {
        this.#batchDepth++;
        try {
            fn();
        } finally {
            this.#batchDepth--;
            if (this.#batchDepth === 0 && this.#dirty) {
                this.#dirty = false;
                this.#notify();
            }
        }
    }

    // --- Internal ---

    #flush(): void {
        if (this.#batchDepth > 0) {
            this.#dirty = true;
        } else {
            this.#notify();
        }
    }

    #notify(): void {
        const array = this.#resolveArray();
        for (const sub of this.#subscribers) {
            sub(array);
        }
    }

    /**
     * Resolves the sorted array view. Caches the result until the next mutation.
     * Sort is only re-run when structural changes (insert/delete) occurred;
     * value-only updates reuse the previous order.
     */
    #resolveArray(): T[] {
        if (this.#cachedArray) return this.#cachedArray;

        // 1. Value-only update: reuse previous order by re-inserting in sorted key order (O(N))
        if (this.#sortFn && !this.#structChanged && this.#map.size > 0) {
            const result: T[] = [];
            for (const id of this.#sortedIds) {
                const item = this.#map.get(id);
                if (item) result.push(item);
            }
            this.#cachedArray = result;
            return result;
        }

        // 2. Structural change (insert/delete) or no sort: compute from scratch
        const arr = Array.from(this.#map.values());
        if (this.#sortFn) {
            arr.sort(this.#sortFn);
        }

        this.#sortedIds = arr.map((item) => item.id);
        this.#structChanged = false;
        this.#cachedArray = arr;
        return arr;
    }
}
