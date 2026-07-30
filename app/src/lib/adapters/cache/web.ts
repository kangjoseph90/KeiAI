import Dexie, { type Table } from 'dexie';
import type { CacheBackend, CacheEntry } from './types';

interface CacheRecord {
    nskey: string;
    namespace: string;
    key: string;
    value: unknown;
    accessedAt: number;
}

class CacheDB extends Dexie {
    entries!: Table<CacheRecord, string>;

    constructor() {
        super('KeiCacheDB');
        this.version(1).stores({
            entries: 'nskey, namespace, [namespace+accessedAt]'
        });
    }
}

const db = new CacheDB();
let lastAccessedAt = Date.now();

function nextAccessedAt(): number {
    lastAccessedAt = Math.max(Date.now(), lastAccessedAt + 1);
    return lastAccessedAt;
}

export class WebCacheBackend implements CacheBackend {
    async loadAll(namespace: string): Promise<CacheEntry[]> {
        const records = await db.entries.where('namespace').equals(namespace).toArray();
        records.sort((left, right) => left.accessedAt - right.accessedAt);
        return records.map(({ key, value }) => ({ key, value }));
    }

    async sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void> {
        if (puts.length === 0 && deletes.length === 0) return;
        const putRecords: CacheRecord[] = puts.map(({ key, value }) => ({
            nskey: `${namespace}:${key}`,
            namespace,
            key,
            value,
            accessedAt: nextAccessedAt()
        }));
        const deleteKeys = deletes.map((key) => `${namespace}:${key}`);
        await db.transaction('rw', db.entries, async () => {
            if (putRecords.length > 0) await db.entries.bulkPut(putRecords);
            if (deleteKeys.length > 0) await db.entries.bulkDelete(deleteKeys);
        });
    }

    async getMany(namespace: string, keys: string[]): Promise<CacheEntry[]> {
        if (keys.length === 0) return [];
        const nskeys = [...new Set(keys)].map((key) => `${namespace}:${key}`);
        return db.transaction('rw', db.entries, async () => {
            const records = (await db.entries.bulkGet(nskeys)).filter(
                (record): record is CacheRecord => record !== undefined
            );
            for (const record of records) {
                record.accessedAt = nextAccessedAt();
            }
            if (records.length > 0) await db.entries.bulkPut(records);
            return records.map(({ key, value }) => ({ key, value }));
        });
    }

    async setMany(namespace: string, entries: CacheEntry[], capacity: number): Promise<void> {
        if (entries.length === 0) return;
        const uniqueEntries = new Map(entries.map((entry) => [entry.key, entry.value]));
        const records: CacheRecord[] = [...uniqueEntries].map(([key, value]) => ({
            nskey: `${namespace}:${key}`,
            namespace,
            key,
            value,
            accessedAt: nextAccessedAt()
        }));

        await db.transaction('rw', db.entries, async () => {
            await db.entries.bulkPut(records);
            const count = await db.entries.where('namespace').equals(namespace).count();
            const excess = count - capacity;
            if (excess <= 0) return;

            const oldestKeys = await db.entries
                .where('[namespace+accessedAt]')
                .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey])
                .limit(excess)
                .primaryKeys();
            await db.entries.bulkDelete(oldestKeys);
        });
    }

    async deleteMany(namespace: string, keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        const nskeys = [...new Set(keys)].map((key) => `${namespace}:${key}`);
        await db.entries.bulkDelete(nskeys);
    }
}
