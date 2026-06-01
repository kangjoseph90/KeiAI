import { clock } from '$lib/utils/clock';
import {
    localDB,
    type DatabaseWriteOptions,
    type DataRecord,
    type TableName
} from '$lib/adapters/db';
import { AppError } from '$lib/types/errors';
import { deepMerge } from '$lib/utils/defaults';
import { LRUCache } from '$lib/utils/cache';

const WRITE_DEBOUNCE_MS = 400;
const WRITE_MAX_WAIT_MS = 2000;

type BufferKey = `${TableName}:${string}`;

interface BufferEntry<TRecord extends DataRecord> {
    key: BufferKey;
    tableName: TableName;
    record: TRecord;
    options?: DatabaseWriteOptions;
    flushTimer: ReturnType<typeof setTimeout> | null;
    maxWaitTimer: ReturnType<typeof setTimeout> | null;
    firstBufferedAt: number;
    flushPromise: Promise<void> | null;
    version: number;
}

class RecordBuffer {
    private readonly entries = new Map<BufferKey, BufferEntry<DataRecord>>();
    private readonly readCache = new LRUCache<BufferKey, DataRecord>(500);
    constructor() {
        this.installWriteInvalidationHook();
        this.installLifecycleFlushHooks();
    }

    async get<TRecord extends DataRecord>(
        tableName: TableName,
        id: string
    ): Promise<TRecord | null> {
        const key = this.getKey(tableName, id);

        const entry = this.entries.get(key);
        if (entry) return structuredClone(entry.record) as TRecord;

        const cached = this.readCache.get(key);
        if (cached) return structuredClone(cached) as TRecord;

        const record = await localDB.getRecord<TRecord>(tableName, id);
        if (record) {
            this.readCache.set(key, structuredClone(record));
            return record;
        }
        return null;
    }

    update<TRecord extends DataRecord>(args: {
        tableName: TableName;
        record: TRecord;
        patch: Record<string, unknown>;
        options?: DatabaseWriteOptions;
    }): TRecord {
        const id = args.record.id;
        const key = this.getKey(args.tableName, id);
        this.readCache.delete(key);
        const existing = this.entries.get(key) as BufferEntry<TRecord> | undefined;

        if (!existing) {
            return this.seed(key, args.tableName, args.record, args.options);
        }

        existing.record = {
            ...existing.record,
            ...args.record,
            data: deepMerge(existing.record.data, args.patch)
        };
        existing.options = args.options;
        existing.version++;
        this.schedule(existing as BufferEntry<DataRecord>);
        return structuredClone(existing.record);
    }

    async flush(tableName: TableName, id: string): Promise<void> {
        await this.flushKey(this.getKey(tableName, id));
    }

    async flushAll(): Promise<void> {
        const keys = Array.from(this.entries.keys());
        await Promise.all(keys.map((key) => this.flushKey(key)));
    }

    async flushTable(tableName: TableName): Promise<void> {
        const keys = Array.from(this.entries.keys()).filter((key) =>
            key.startsWith(`${tableName}:`)
        );
        await Promise.all(keys.map((key) => this.flushKey(key)));
    }

    drop(tableName: TableName, id: string): void {
        const key = this.getKey(tableName, id);
        this.readCache.delete(key);

        const entry = this.entries.get(key);
        if (!entry) return;
        this.clearTimers(entry);
        this.entries.delete(key);
    }

    private getKey(tableName: TableName, id: string): BufferKey {
        return `${tableName}:${id}`;
    }

    private seed<TRecord extends DataRecord>(
        key: BufferKey,
        tableName: TableName,
        record: TRecord,
        options?: DatabaseWriteOptions
    ): TRecord {
        const created: BufferEntry<TRecord> = {
            key,
            tableName,
            record: structuredClone(record),
            options,
            flushTimer: null,
            maxWaitTimer: null,
            firstBufferedAt: clock.now(),
            flushPromise: null,
            version: 0
        };
        this.entries.set(key, created as BufferEntry<DataRecord>);
        this.schedule(created as BufferEntry<DataRecord>);
        return structuredClone(created.record);
    }

    private schedule(entry: BufferEntry<DataRecord>): void {
        if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
        }

        entry.flushTimer = setTimeout(() => {
            void this.flushKey(entry.key);
        }, WRITE_DEBOUNCE_MS);

        if (!entry.maxWaitTimer) {
            entry.maxWaitTimer = setTimeout(() => {
                void this.flushKey(entry.key);
            }, WRITE_MAX_WAIT_MS);
        }
    }

    private clearTimers(entry: BufferEntry<DataRecord>): void {
        if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
            entry.flushTimer = null;
        }
        if (entry.maxWaitTimer) {
            clearTimeout(entry.maxWaitTimer);
            entry.maxWaitTimer = null;
        }
    }

    private async flushKey(key: BufferKey): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry) return;

        if (entry.flushPromise) {
            await entry.flushPromise;
            return;
        }

        const snapshot = structuredClone(entry.record);
        const flushVersion = entry.version;
        this.clearTimers(entry);

        entry.flushPromise = (async () => {
            snapshot.updatedAt = clock.now();
            await localDB.putRecord(entry.tableName, snapshot, entry.options);
        })();

        try {
            await entry.flushPromise;

            const current = this.entries.get(key);
            if (current === entry && current.version === flushVersion) {
                this.entries.delete(key);
            } else if (current === entry) {
                this.schedule(current);
            }
        } catch (error) {
            this.schedule(entry);
            throw new AppError('DB_WRITE_FAILED', `Failed to flush queued write: ${key}`, error);
        } finally {
            entry.flushPromise = null;
        }
    }

    private installWriteInvalidationHook(): void {
        localDB.subscribeWriteEvents((events) => {
            for (const event of events) {
                for (const id of event.ids) {
                    this.readCache.delete(this.getKey(event.tableName, id));
                }
            }
        });
    }

    private installLifecycleFlushHooks(): void {
        if (typeof window === 'undefined') return;

        const flushSoon = () => {
            void this.flushAll();
        };

        window.addEventListener('pagehide', flushSoon);
        window.addEventListener('beforeunload', flushSoon);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flushSoon();
            }
        });
    }
}

export const buffer = new RecordBuffer();
