import Dexie, { type Table } from 'dexie';
import type { CacheBackend, CacheEntry } from './types';

interface CacheRecord {
    nskey: string;
    namespace: string;
    key: string;
    value: unknown;
}

class CacheDB extends Dexie {
    entries!: Table<CacheRecord, string>;

    constructor() {
        super('KeiCacheDB');
        this.version(1).stores({
            entries: 'nskey, namespace'
        });
    }
}

const db = new CacheDB();

export class WebCacheBackend implements CacheBackend {
    async loadAll(namespace: string): Promise<CacheEntry[]> {
        const records = await db.entries.where('namespace').equals(namespace).toArray();
        return records.map(({ key, value }) => ({ key, value }));
    }

    async sync(namespace: string, puts: CacheEntry[], deletes: string[]): Promise<void> {
        if (puts.length === 0 && deletes.length === 0) return;
        const putRecords: CacheRecord[] = puts.map(({ key, value }) => ({
            nskey: `${namespace}:${key}`,
            namespace,
            key,
            value
        }));
        const deleteKeys = deletes.map((key) => `${namespace}:${key}`);
        await db.transaction('rw', db.entries, async () => {
            if (putRecords.length > 0) await db.entries.bulkPut(putRecords);
            if (deleteKeys.length > 0) await db.entries.bulkDelete(deleteKeys);
        });
    }
}
