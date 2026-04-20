/**
 * LRUCache Tests — KeiAI
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '$lib/utils/cache';

describe('LRUCache', () => {
    describe('basic operations', () => {
        it('should store and retrieve values', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 100);
            cache.set('key2', 200);

            expect(cache.get('key1')).toBe(100);
            expect(cache.get('key2')).toBe(200);
        });

        it('should return undefined for non-existent keys', () => {
            const cache = new LRUCache<string, number>(10);
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('should report correct size', () => {
            const cache = new LRUCache<string, number>(10);
            expect(cache.size).toBe(0);

            cache.set('key1', 1);
            expect(cache.size).toBe(1);

            cache.set('key2', 2);
            cache.set('key3', 3);
            expect(cache.size).toBe(3);
        });

        it('should check if key exists', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);

            expect(cache.has('key1')).toBe(true);
            expect(cache.has('nonexistent')).toBe(false);
        });

        it('should delete specific keys', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);

            expect(cache.has('key1')).toBe(true);
            const deleted = cache.delete('key1');
            expect(deleted).toBe(true);
            expect(cache.has('key1')).toBe(false);
            expect(cache.size).toBe(1);
        });

        it('should return false when deleting non-existent key', () => {
            const cache = new LRUCache<string, number>(10);
            const deleted = cache.delete('nonexistent');
            expect(deleted).toBe(false);
        });

        it('should clear all entries', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            expect(cache.size).toBe(3);
            cache.clear();
            expect(cache.size).toBe(0);
            expect(cache.get('key1')).toBeUndefined();
        });
    });

    describe('LRU eviction', () => {
        it('should evict least recently used entry when at capacity', () => {
            const cache = new LRUCache<string, number>(3);

            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);
            expect(cache.size).toBe(3);

            // Adding 4th entry should evict key1 (least recently used)
            cache.set('key4', 4);
            expect(cache.size).toBe(3);
            expect(cache.get('key1')).toBeUndefined(); // Evicted
            expect(cache.get('key2')).toBe(2);
            expect(cache.get('key3')).toBe(3);
            expect(cache.get('key4')).toBe(4);
        });

        it('should promote entry to most recently used on get', () => {
            const cache = new LRUCache<string, number>(3);

            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            // Access key1 to make it more recent than key2
            cache.get('key1');

            // Adding 4th entry should evict key2 (now least recently used)
            cache.set('key4', 4);
            expect(cache.get('key1')).toBe(1); // Still there (was accessed)
            expect(cache.get('key2')).toBeUndefined(); // Evicted
            expect(cache.get('key3')).toBe(3);
            expect(cache.get('key4')).toBe(4);
        });

        it('should update existing key and promote to most recent', () => {
            const cache = new LRUCache<string, number>(3);

            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            // Update key1 to make it more recent
            cache.set('key1', 100);

            // Adding 4th entry should evict key2
            cache.set('key4', 4);
            expect(cache.get('key1')).toBe(100); // Updated value
            expect(cache.get('key2')).toBeUndefined(); // Evicted
            expect(cache.get('key3')).toBe(3);
            expect(cache.get('key4')).toBe(4);
        });
    });

    describe('iteration', () => {
        it('should iterate keys in insertion order (LRU first)', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            const keys = Array.from(cache.keys());
            expect(keys).toEqual(['key1', 'key2', 'key3']);
        });

        it('should iterate values in insertion order', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            const values = Array.from(cache.values());
            expect(values).toEqual([1, 2, 3]);
        });

        it('should iterate entries in insertion order', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            const entries = Array.from(cache.entries());
            expect(entries).toEqual([
                ['key1', 1],
                ['key2', 2],
                ['key3', 3]
            ]);
        });

        it('should update iteration order when key is accessed', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('key1', 1);
            cache.set('key2', 2);
            cache.set('key3', 3);

            // Access key1 to move it to end
            cache.get('key1');

            const keys = Array.from(cache.keys());
            expect(keys).toEqual(['key2', 'key3', 'key1']);
        });
    });

    describe('type flexibility', () => {
        it('should work with number keys', () => {
            const cache = new LRUCache<number, string>(5);
            cache.set(1, 'one');
            cache.set(2, 'two');

            expect(cache.get(1)).toBe('one');
            expect(cache.get(2)).toBe('two');
        });

        it('should work with object keys (using reference equality)', () => {
            const cache = new LRUCache<{ id: number }, string>(5);
            const key1 = { id: 1 };
            const key2 = { id: 2 };

            cache.set(key1, 'one');
            cache.set(key2, 'two');

            expect(cache.get(key1)).toBe('one');
            expect(cache.get(key2)).toBe('two');

            // Different object reference, even with same id
            expect(cache.get({ id: 1 })).toBeUndefined();
        });

        it('should work with complex values', () => {
            type Value = { num: number; str: string };
            const cache = new LRUCache<string, Value>(5);

            cache.set('key1', { num: 42, str: 'hello' });
            const result = cache.get('key1');

            expect(result).toEqual({ num: 42, str: 'hello' });
        });
    });

    describe('edge cases', () => {
        it('should handle maxSize of 1', () => {
            const cache = new LRUCache<string, number>(1);

            cache.set('key1', 1);
            expect(cache.size).toBe(1);
            expect(cache.get('key1')).toBe(1);

            cache.set('key2', 2);
            expect(cache.size).toBe(1);
            expect(cache.get('key1')).toBeUndefined();
            expect(cache.get('key2')).toBe(2);
        });

        it('should handle empty string keys', () => {
            const cache = new LRUCache<string, number>(10);
            cache.set('', 100);
            expect(cache.get('')).toBe(100);
        });

        it('should handle null and undefined values', () => {
            const cache = new LRUCache<string, number | null | undefined>(10);

            cache.set('null', null);
            cache.set('undefined', undefined);

            expect(cache.get('null')).toBeNull();
            expect(cache.get('undefined')).toBeUndefined();
        });
    });
});
