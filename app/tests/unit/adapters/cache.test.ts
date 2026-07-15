/**
 * Cache Adapter Tests — KeiAI
 *
 * Verifies createCache() against the Web (Dexie/IndexedDB) backend:
 * - flush() persists changed keys only (no full-namespace rewrite)
 * - LRU eviction surfaces as DB deletion at flush time
 * - Explicit delete() removes the DB record
 * - Surviving keys are preserved across a fresh cache instance (reload)
 * - get() is synchronous and does not schedule flushes
 *
 * Runs under isTauri() === false (setup.ts), so TauriCacheBackend is untouched.
 * We call cache.flush() directly instead of waiting on the debounce timer —
 * fake-indexeddb schedules IDB work via setTimeout(0), which would deadlock
 * under vi.useFakeTimers(). The flush() code path is what we want to verify.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCache } from '$lib/adapters/cache';
import Dexie from 'dexie';

// Reads underlying rows directly from Dexie to assert what actually landed in
// storage, bypassing the cache's in-memory state.
function readNamespace(namespace: string): Promise<Map<string, unknown>> {
    const db = new Dexie('KeiCacheDB');
    db.version(1).stores({ entries: 'nskey, namespace' });
    return db
        .open()
        .then(() => db.table('entries').where('namespace').equals(namespace).toArray())
        .then((rows) => {
            const map = new Map<string, unknown>();
            for (const row of rows) map.set(row.key, row.value);
            return map;
        })
        .finally(() => db.close());
}

describe('createCache (Web backend)', () => {
    it('persists set() entries to IndexedDB on flush', async () => {
        const cache = createCache<{ n: number }>('persist', 10);
        cache.set('a', { n: 1 });
        cache.set('b', { n: 2 });

        // Nothing written before an explicit flush.
        let rows = await readNamespace('persist');
        expect(rows.size).toBe(0);

        await cache.flush();

        rows = await readNamespace('persist');
        expect(rows.size).toBe(2);
        expect(rows.get('a')).toEqual({ n: 1 });
        expect(rows.get('b')).toEqual({ n: 2 });
    });

    it('flushes only changed keys, not the whole namespace', async () => {
        const cache = createCache<number>('delta', 10);
        cache.set('a', 1);
        cache.set('b', 2);
        await cache.flush();

        // Mutate a single key and flush again. Only 'a' should be rewritten;
        // 'b' must remain untouched.
        cache.set('a', 11);
        await cache.flush();

        const rows = await readNamespace('delta');
        expect(rows.get('a')).toBe(11);
        expect(rows.get('b')).toBe(2);
        expect(rows.size).toBe(2);
    });

    it('reflects LRU eviction as DB deletion at flush time', async () => {
        const cache = createCache<number>('evict', 3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Saturate, then push one past capacity → 'a' evicted in memory.
        cache.set('d', 4);
        await cache.flush();

        const rows = await readNamespace('evict');
        expect(rows.has('a')).toBe(false);
        expect(rows.get('b')).toBe(2);
        expect(rows.get('c')).toBe(3);
        expect(rows.get('d')).toBe(4);
    });

    it('reflects explicit delete() as DB deletion at flush time', async () => {
        const cache = createCache<number>('del', 10);
        cache.set('a', 1);
        cache.set('b', 2);
        await cache.flush();

        cache.delete('a');
        await cache.flush();

        const rows = await readNamespace('del');
        expect(rows.has('a')).toBe(false);
        expect(rows.get('b')).toBe(2);
        expect(rows.size).toBe(1);
    });

    it('preserves surviving entries across a fresh instance (reload)', async () => {
        const cache = createCache<number>('reload', 10);
        cache.set('a', 1);
        cache.set('b', 2);
        await cache.flush();

        // New cache instance pointing at the same namespace must hydrate
        // from persisted storage.
        const reloaded = createCache<number>('reload', 10);
        await reloaded.flush(); // resolves loadPromise

        expect(reloaded.get('a')).toBe(1);
        expect(reloaded.get('b')).toBe(2);
    });

    it('get() is synchronous and does not schedule flushes', () => {
        const cache = createCache<number>('get-sync', 10);
        cache.set('a', 1);

        const before = cache.get('a');
        expect(before).toBe(1);

        // A read-only access must not arm a new debounce timer.
        const spy = vi.spyOn(globalThis, 'setTimeout');
        cache.get('a');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('coalesces rapid mutations into a single flush', async () => {
        const cache = createCache<number>('coalesce', 10);
        cache.set('a', 1);
        cache.set('a', 2);
        cache.set('a', 3);
        cache.set('b', 9);

        await cache.flush();

        const rows = await readNamespace('coalesce');
        expect(rows.get('a')).toBe(3); // last write wins
        expect(rows.get('b')).toBe(9);
        expect(rows.size).toBe(2);
    });
});
