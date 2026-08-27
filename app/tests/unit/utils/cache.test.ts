/**
 * LRUCache Tests — KeiAI
 *
 * Count mode: FIFO eviction at capacity and recency refresh on get().
 * Byte-budget mode (estimateSize): maxSize is a total budget, entries are
 * evicted least-recently-used-first until it fits, and a lone oversized
 * value is retained rather than rejected.
 */

import { describe, expect, it } from 'vitest';
import { LRUCache } from '$lib/utils/cache';

describe('LRUCache (count mode)', () => {
    it('evicts the least recently set entry beyond capacity', () => {
        const cache = new LRUCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        expect(cache.has('a')).toBe(false);
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
    });

    it('refreshes recency on get()', () => {
        const cache = new LRUCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a');
        cache.set('c', 3);

        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });

    it('replacing an existing key does not evict', () => {
        const cache = new LRUCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10);

        expect(cache.size).toBe(2);
        expect(cache.get('a')).toBe(10);
    });

    it('delete and clear release all state', () => {
        const cache = new LRUCache<string, number>(2);
        cache.set('a', 1);
        expect(cache.delete('a')).toBe(true);
        expect(cache.delete('missing')).toBe(false);

        cache.set('b', 2);
        cache.clear();
        expect(cache.size).toBe(0);
    });
});

describe('LRUCache (byte-budget mode)', () => {
    it('bounds resident bytes instead of entry count', () => {
        // Two vectors per budget slot of 8 bytes.
        const cache = new LRUCache<string, Float32Array>(8, {
            estimateSize: (vector) => vector.byteLength
        });
        cache.set('v1', new Float32Array(2)); // 8 bytes
        cache.set('v2', new Float32Array(2)); // 8 bytes → v1 evicted
        cache.set('v3', new Float32Array(2)); // 8 bytes → v2 evicted

        expect(cache.size).toBe(1);
        expect(cache.has('v1')).toBe(false);
        expect(cache.has('v2')).toBe(false);
        expect(cache.has('v3')).toBe(true);
    });

    it('keeps small hot vectors alive while large cold ones churn', () => {
        const cache = new LRUCache<string, Float32Array>(24, {
            estimateSize: (vector) => vector.byteLength
        });
        cache.set('small', new Float32Array(1)); // 4 bytes
        for (let index = 0; index < 5; index += 1) {
            cache.get('small'); // refresh recency like a repeated search would
            cache.set(`large-${index}`, new Float32Array(5)); // 20 bytes each
        }

        // The tiny entry is refreshed before every oversized insert, so the
        // budget always pushes out the previous large vector instead of it.
        expect(cache.get('small')).toBeDefined();

        let survivors = 0;
        for (let index = 0; index < 5; index += 1) if (cache.has(`large-${index}`)) survivors += 1;
        expect(survivors).toBeLessThan(5);
    });

    it('refreshes recency by bytes on get()', () => {
        const cache = new LRUCache<string, Float32Array>(12, {
            estimateSize: (vector) => vector.byteLength
        });
        cache.set('a', new Float32Array(1)); // 4 bytes
        cache.set('b', new Float32Array(1)); // 4 bytes
        cache.set('c', new Float32Array(1)); // 4 bytes, exactly full

        cache.get('a');
        cache.set('d', new Float32Array(1)); // must evict 'b' (now LRU)

        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
        expect(cache.has('c')).toBe(true);
        expect(cache.has('d')).toBe(true);
    });

    it('retains a single value larger than the whole budget', () => {
        const cache = new LRUCache<string, Float32Array>(8, {
            estimateSize: (vector) => vector.byteLength
        });
        cache.set('big', new Float32Array(16)); // 64 bytes ≫ 8

        expect(cache.size).toBe(1);
        expect(cache.get('big')).toHaveLength(16);

        cache.set('small', new Float32Array(1));
        expect(cache.size).toBe(1);
        expect(cache.has('small')).toBe(true);
    });
});
