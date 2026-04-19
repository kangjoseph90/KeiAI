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

	constructor(options?: EntityStoreOptions<T>) {
		this.#sortFn = options?.sortFn;
	}

	// --- Readable<T[]> ---

	subscribe = (run: Subscriber<T[]>): Unsubscriber => {
		this.#subscribers.add(run);
		run(this.#toArray());
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
		this.#flush();
	}

	set(id: string, item: T): void {
		this.#map.set(id, item);
		this.#flush();
	}

	delete(id: string): boolean {
		if (this.#map.delete(id)) {
			this.#flush();
			return true;
		}
		return false;
	}

	clear(): void {
		if (this.#map.size > 0) {
			this.#map.clear();
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
		const array = this.#toArray();
		for (const sub of this.#subscribers) {
			sub(array);
		}
	}

	#toArray(): T[] {
		const arr = Array.from(this.#map.values());
		if (this.#sortFn) {
			arr.sort(this.#sortFn);
		}
		return arr;
	}
}
