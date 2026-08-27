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
import { createAsyncCache, createCache } from '$lib/adapters/cache';
import Dexie from 'dexie';

// Reads underlying rows directly from Dexie to assert what actually landed in
// storage, bypassing the cache's in-memory state.
function readNamespace(namespace: string): Promise<Map<string, unknown>> {
    const db = new Dexie('KeiCacheDB');
    db.version(1).stores({ entries: '[namespace+key], [namespace+accessedAt]' });
    return db
        .open()
        .then(() =>
            db
                .table('entries')
                .where('[namespace+key]')
                .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey])
                .toArray()
        )
        .then((rows) => {
            const map = new Map<string, unknown>();
            for (const row of rows) map.set(row.key, row.value);
            return map;
        })
        .finally(() => db.close());
}

// Same, but preserves full records (including accessedAt) for write-tracking
// assertions.
function readRecords(namespace: string): Promise<Map<string, Record<string, unknown>>> {
    const db = new Dexie('KeiCacheDB');
    db.version(1).stores({ entries: '[namespace+key], [namespace+accessedAt]' });
    return db
        .open()
        .then(() =>
            db
                .table('entries')
                .where('[namespace+key]')
                .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey])
                .toArray()
        )
        .then((rows) => {
            const map = new Map<string, Record<string, unknown>>();
            for (const row of rows) map.set(row.key as string, { ...row });
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

    it('deletes persisted entries evicted after hydration', async () => {
        const initial = createCache<number>('hydrated-eviction', 2);
        initial.set('a', 1);
        initial.set('b', 2);
        await initial.flush();

        const reloaded = createCache<number>('hydrated-eviction', 2);
        await reloaded.flush();
        reloaded.get('a');
        reloaded.set('c', 3);
        await reloaded.flush();

        const rows = await readNamespace('hydrated-eviction');
        expect(rows).toEqual(
            new Map([
                ['a', 1],
                ['c', 3]
            ])
        );
    });
});

describe('createAsyncCache (Web backend)', () => {
    it('reads and writes keys without creating an in-memory cache instance', async () => {
        const cache = createAsyncCache<{ n: number }>('async-read-write', 10);
        await cache.setMany([
            ['a', { n: 1 }],
            ['b', { n: 2 }]
        ]);

        await expect(cache.getMany(['b', 'missing'])).resolves.toEqual(new Map([['b', { n: 2 }]]));
    });

    it('evicts the least recently used persisted entry on set', async () => {
        const cache = createAsyncCache<number>('async-eviction', 2);
        await cache.setMany([
            ['a', 1],
            ['b', 2]
        ]);
        await cache.get('a');
        await cache.set('c', 3);

        await expect(cache.getMany(['a', 'b', 'c'])).resolves.toEqual(
            new Map([
                ['a', 1],
                ['c', 3]
            ])
        );
        expect(await readNamespace('async-eviction')).toEqual(
            new Map([
                ['a', 1],
                ['c', 3]
            ])
        );
    });

    it('does not rewrite records when reading', async () => {
        const cache = createAsyncCache<number>('no-read-writes', 10);
        await cache.setMany([
            ['a', 1],
            ['b', 2]
        ]);
        const before = await readRecords('no-read-writes');

        // Hits are only queued in memory; nothing may be persisted here.
        await expect(cache.getMany(['a', 'b'])).resolves.toEqual(
            new Map([
                ['a', 1],
                ['b', 2]
            ])
        );
        const afterReads = await readRecords('no-read-writes');
        expect(afterReads).toEqual(before);

        // The next write persists the queued touches as one batched update.
        await cache.set('c', 3);
        const afterDrain = await readRecords('no-read-writes');
        for (const key of ['a', 'b']) {
            expect(afterDrain.get(key)?.accessedAt).toBeGreaterThan(
                before.get(key)?.accessedAt as number
            );
        }
    });

    it('persists Float32Array values as structured typed arrays (binary, not JSON)', async () => {
        const cache = createAsyncCache<Float32Array>('binary-vectors', 4);
        const vector = new Float32Array([0.25, -1.5, Number.EPSILON]);
        await cache.setMany([['v', vector]]);

        const raw = await readNamespace('binary-vectors');
        const stored = raw.get('v');
        expect(stored).toBeInstanceOf(Float32Array);
        expect(stored).not.toBe(vector); // a persisted copy, not the live instance
        expect(Array.from(stored as Float32Array)).toEqual([0.25, -1.5, Number.EPSILON]);

        await expect(cache.getMany(['v'])).resolves.toEqual(new Map([['v', vector]]));
        const [reread] = [...(await cache.getMany(['v'])).values()];
        expect(reread).toBeInstanceOf(Float32Array);
    });
});
