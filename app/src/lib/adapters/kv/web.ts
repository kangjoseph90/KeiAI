import type { AsyncKeyValueStore, KeyValueStore } from './types';

/** Synchronous localStorage access for device UI preferences. */
export class LocalStorageKeyValueStore implements KeyValueStore {
    get(key: string): string | null {
        return localStorage.getItem(key);
    }

    set(key: string, value: string): void {
        localStorage.setItem(key, value);
    }

    remove(key: string): void {
        localStorage.removeItem(key);
    }

    keys(prefix?: string): string[] {
        const keys = Array.from({ length: localStorage.length }, (_, index) =>
            localStorage.key(index)
        ).filter((key): key is string => key !== null);
        return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
    }
}

/** Async facade used by appKV on the web. */
export class WebKeyValueAdapter implements AsyncKeyValueStore {
    constructor(private readonly storage: KeyValueStore = new LocalStorageKeyValueStore()) {}

    async get(key: string): Promise<string | null> {
        return this.storage.get(key);
    }

    async set(key: string, value: string): Promise<void> {
        this.storage.set(key, value);
    }

    async remove(key: string): Promise<void> {
        this.storage.remove(key);
    }

    async keys(prefix?: string): Promise<string[]> {
        return this.storage.keys(prefix);
    }

    async init(): Promise<void> {
        // localStorage requires no initialization.
    }
}
