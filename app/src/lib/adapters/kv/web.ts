import type { IKeyValueAdapter } from './types';

/**
 * Web Key-Value Adapter
 *
 * Uses the standard browser localStorage API.
 * Made async to match the Tauri Store plugin signature.
 */
export class WebKeyValueAdapter implements IKeyValueAdapter {
    async get(key: string): Promise<string | null> {
        return localStorage.getItem(key);
    }

    async set(key: string, value: string): Promise<void> {
        localStorage.setItem(key, value);
    }

    async remove(key: string): Promise<void> {
        localStorage.removeItem(key);
    }

    async keys(prefix?: string): Promise<string[]> {
        const keys = Array.from({ length: localStorage.length }, (_, index) =>
            localStorage.key(index)
        ).filter((key): key is string => key !== null);
        return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
    }

    async init(): Promise<void> {
        // No initialization needed for localStorage
        return Promise.resolve();
    }
}
