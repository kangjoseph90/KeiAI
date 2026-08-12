/**
 * Key-Value Adapter Tests
 *
 * Tests WebKeyValueAdapter (localStorage wrapper) and
 * validates the interface contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebKeyValueAdapter } from '$lib/adapters/kv/web';
import type { AsyncKeyValueStore } from '$lib/adapters/kv/types';

describe('WebKeyValueAdapter (localStorage)', () => {
    let adapter: AsyncKeyValueStore;

    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        adapter = new WebKeyValueAdapter();
    });

    afterEach(() => {
        localStorage.clear();
    });

    describe('init', () => {
        it('should initialize without error', async () => {
            await expect(adapter.init()).resolves.not.toThrow();
        });

        it('should be idempotent (multiple calls safe)', async () => {
            await adapter.init();
            await adapter.init();
            await adapter.init();

            // No assertion needed - just verifies no errors thrown
            expect(true).toBe(true);
        });
    });

    describe('get and set', () => {
        it('should store and retrieve a string value', async () => {
            await adapter.set('test-key', 'test-value');
            const result = await adapter.get('test-key');

            expect(result).toBe('test-value');
        });

        it('should return null for non-existent key', async () => {
            const result = await adapter.get('non-existent-key');

            expect(result).toBeNull();
        });

        it('should handle empty string values', async () => {
            await adapter.set('empty-key', '');
            const result = await adapter.get('empty-key');

            expect(result).toBe('');
        });

        it('should overwrite existing values', async () => {
            await adapter.set('key', 'first-value');
            await adapter.set('key', 'second-value');

            const result = await adapter.get('key');
            expect(result).toBe('second-value');
        });

        it('should handle special characters in values', async () => {
            const specialValue = 'Hello "world"!\nNew lines\tTabs';
            await adapter.set('special-key', specialValue);

            const result = await adapter.get('special-key');
            expect(result).toBe(specialValue);
        });

        it('should handle unicode characters', async () => {
            const unicodeValue = '🔥✨한글中文日本語';
            await adapter.set('unicode-key', unicodeValue);

            const result = await adapter.get('unicode-key');
            expect(result).toBe(unicodeValue);
        });

        it('should handle very long strings', async () => {
            // localStorage has a limit of ~5MB, so 100KB should be fine
            const longValue = 'x'.repeat(100_000);
            await adapter.set('long-key', longValue);

            const result = await adapter.get('long-key');
            expect(result).toBe(longValue);
        });
    });

    describe('remove', () => {
        it('should remove a stored value', async () => {
            await adapter.set('delete-me', 'value');

            await adapter.remove('delete-me');

            const result = await adapter.get('delete-me');
            expect(result).toBeNull();
        });

        it('should not throw when removing non-existent key', async () => {
            await expect(adapter.remove('non-existent-key')).resolves.not.toThrow();
        });

        it('should allow reusing a key after removal', async () => {
            await adapter.set('reuse-key', 'first');
            await adapter.remove('reuse-key');
            await adapter.set('reuse-key', 'second');

            const result = await adapter.get('reuse-key');
            expect(result).toBe('second');
        });
    });

    describe('key isolation', () => {
        it('should not interfere with other keys', async () => {
            await adapter.set('key1', 'value1');
            await adapter.set('key2', 'value2');
            await adapter.set('key3', 'value3');

            await adapter.remove('key2');

            expect(await adapter.get('key1')).toBe('value1');
            expect(await adapter.get('key2')).toBeNull();
            expect(await adapter.get('key3')).toBe('value3');
        });

        it('should handle keys with similar prefixes', async () => {
            await adapter.set('user:id', 'user-data');
            await adapter.set('user:name', 'name-data');
            await adapter.set('user:id:backup', 'backup-data');

            expect(await adapter.get('user:id')).toBe('user-data');
            expect(await adapter.get('user:name')).toBe('name-data');
            expect(await adapter.get('user:id:backup')).toBe('backup-data');
        });
    });

    describe('integration scenarios', () => {
        it('should handle typical user session workflow', async () => {
            // Set active session
            await adapter.set('activeSessionId', 'session-123');

            // Verify it's stored
            expect(await adapter.get('activeSessionId')).toBe('session-123');

            // Clear session (logout)
            await adapter.remove('activeSessionId');

            // Verify it's cleared
            expect(await adapter.get('activeSessionId')).toBeNull();
        });

        it('should handle user preferences', async () => {
            // Store theme preference
            await adapter.set('pref:theme', 'dark');
            expect(await adapter.get('pref:theme')).toBe('dark');

            // Change theme
            await adapter.set('pref:theme', 'light');
            expect(await adapter.get('pref:theme')).toBe('light');

            // Remove preference
            await adapter.remove('pref:theme');
            expect(await adapter.get('pref:theme')).toBeNull();
        });
    });
});

describe('AsyncKeyValueStore interface contract', () => {
    it('should have all required methods', async () => {
        const adapter = new WebKeyValueAdapter();

        expect(typeof adapter.get).toBe('function');
        expect(typeof adapter.set).toBe('function');
        expect(typeof adapter.remove).toBe('function');
        expect(typeof adapter.init).toBe('function');
    });

    it('should have async methods that return promises', async () => {
        const adapter = new WebKeyValueAdapter();

        const getPromise = adapter.get('key');
        const setPromise = adapter.set('key', 'value');
        const removePromise = adapter.remove('key');
        const initPromise = adapter.init();

        expect(getPromise).toBeInstanceOf(Promise);
        expect(setPromise).toBeInstanceOf(Promise);
        expect(removePromise).toBeInstanceOf(Promise);
        expect(initPromise).toBeInstanceOf(Promise);

        // Clean up
        await Promise.all([getPromise, setPromise, removePromise, initPromise]);
        await adapter.remove('key');
    });
});
