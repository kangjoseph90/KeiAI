import Dexie, { type Table } from 'dexie';
import type { CacheBackend, CacheEntry } from './types';

interface CacheRecord {
    namespace: string;
    key: string;
    value: unknown;
    accessedAt: number;
}

class CacheDB extends Dexie {
    entries!: Table<CacheRecord, [string, string]>;

    constructor() {
        super('KeiCacheDB');
        this.version(1).stores({
            entries: '[namespace+key], [namespace+accessedAt]'
        });
    }
}

const db = new CacheDB();
let lastAccessedAt = Date.now();

function nextAccessedAt(): number {
    lastAccessedAt = Math.max(Date.now(), lastAccessedAt + 1);
    return lastAccessedAt;
}

const pendingTouches = new Map<string, Set<string>>();
let touchFlushChain: Promise<void> = Promise.resolve();
const TOUCH_FLUSH_THRESHOLD = 256;

export class WebCacheBackend implements CacheBackend {
    async loadAll(namespace: string): Promise<CacheEntry[]> {
        const records = await db.entries
            .where('[namespace+key]')
            .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey])
            .toArray();
        records.sort((left, right) => left.accessedAt - right.accessedAt);
        return records.map(({ key, value }) => ({ key, value }));
    }

    async sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void> {
        if (puts.length === 0 && deletes.length === 0) return;
        const putRecords: CacheRecord[] = puts.map(({ key, value }) => ({
            namespace,
            key,
            value,
            accessedAt: nextAccessedAt()
        }));
        const deleteKeys = deletes.map((key) => [namespace, key] as [string, string]);
        await db.transaction('rw', db.entries, async () => {
            if (putRecords.length > 0) await db.entries.bulkPut(putRecords);
            if (deleteKeys.length > 0) await db.entries.bulkDelete(deleteKeys);
        });
    }

    async getMany(namespace: string, keys: string[]): Promise<CacheEntry[]> {
        if (keys.length === 0) return [];
        const uniqueKeys = [...new Set(keys)];
        const records = (
            (await db.entries.bulkGet(uniqueKeys.map((key) => [namespace, key]))) as Array<
                CacheRecord | undefined
            >
        ).filter((record): record is CacheRecord => record !== undefined);
        return records.map(({ key, value }) => ({ key, value }));
    }

    queueTouch(namespace: string, keys: string[]): boolean {
        let pending = pendingTouches.get(namespace);
        if (!pending) {
            pending = new Set();
            pendingTouches.set(namespace, pending);
        }
        for (const key of keys) pending.add(key);
        return pending.size >= TOUCH_FLUSH_THRESHOLD;
    }

    flushTouches(): Promise<void> {
        const run = touchFlushChain.then(() => {
            if (pendingTouches.size === 0) return;
            const snapshots = [...pendingTouches].map(([namespace, keys]) => ({
                namespace,
                keys: [...keys]
            }));
            pendingTouches.clear();
            const accessedAt = nextAccessedAt();
            const runs = snapshots.map(({ namespace, keys }) =>
                db.entries
                    .where('[namespace+key]')
                    .anyOf(keys.map((key) => [namespace, key]))
                    .modify((record) => {
                        record.accessedAt = accessedAt;
                    })
            );
            return Promise.all(runs).then(() => undefined);
        });
        touchFlushChain = run.catch(() => undefined);
        return run;
    }

    async setMany(namespace: string, entries: CacheEntry[], capacity: number): Promise<void> {
        if (entries.length === 0) return;
        const uniqueEntries = new Map(entries.map((entry) => [entry.key, entry.value]));
        const records: CacheRecord[] = [...uniqueEntries].map(([key, value]) => ({
            namespace,
            key,
            value,
            accessedAt: nextAccessedAt()
        }));

        await db.transaction('rw', db.entries, async () => {
            await db.entries.bulkPut(records);
            const oldest = () =>
                db.entries
                    .where('[namespace+accessedAt]')
                    .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey]);
            const excess = (await oldest().count()) - capacity;
            if (excess <= 0) return;

            const oldestKeys = await oldest().limit(excess).primaryKeys();
            await db.entries.bulkDelete(oldestKeys);
        });
    }

    async deleteMany(namespace: string, keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        const uniqueKeys = [...new Set(keys)];
        await db.entries.bulkDelete(uniqueKeys.map((key) => [namespace, key] as [string, string]));
    }
}
