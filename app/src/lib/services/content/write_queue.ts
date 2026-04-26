import { clock } from '$lib/utils/clock';
import {
    localDB,
    type DatabaseWriteOptions,
    type DataRecord,
    type TableName
} from '$lib/adapters/db';
import { AppError } from '$lib/types/errors';

const WRITE_DEBOUNCE_MS = 400;
const WRITE_MAX_WAIT_MS = 2000;

type QueueKey = `${TableName}:${string}`;

interface QueueEntry<TRecord extends DataRecord> {
    key: QueueKey;
    tableName: TableName;
    record: TRecord;
    options?: DatabaseWriteOptions;
    mergeData?: (
        current: Record<string, unknown>,
        next: Record<string, unknown>
    ) => Record<string, unknown>;
    flushTimer: ReturnType<typeof setTimeout> | null;
    maxWaitTimer: ReturnType<typeof setTimeout> | null;
    firstQueuedAt: number;
    flushPromise: Promise<void> | null;
    version: number;
}

class WriteQueue {
    private readonly entries = new Map<QueueKey, QueueEntry<DataRecord>>();

    constructor() {
        this.installLifecycleFlushHooks();
    }

    peek<TRecord extends DataRecord>(tableName: TableName, id: string): TRecord | null {
        const entry = this.entries.get(this.getKey(tableName, id));
        if (!entry) return null;
        return structuredClone(entry.record) as TRecord;
    }

    upsert<TRecord extends DataRecord>(args: {
        tableName: TableName;
        record: TRecord;
        mergeData?: (
            current: Record<string, unknown>,
            next: Record<string, unknown>
        ) => Record<string, unknown>;
        options?: DatabaseWriteOptions;
    }): TRecord {
        const id = args.record.id;
        const key = this.getKey(args.tableName, id);
        const existing = this.entries.get(key) as QueueEntry<TRecord> | undefined;

        if (!existing) {
            const now = clock.now();
            const created: QueueEntry<TRecord> = {
                key,
                tableName: args.tableName,
                record: structuredClone(args.record),
                options: args.options,
                mergeData: args.mergeData,
                flushTimer: null,
                maxWaitTimer: null,
                firstQueuedAt: now,
                flushPromise: null,
                version: 0
            };
            this.entries.set(key, created as QueueEntry<DataRecord>);
            this.schedule(created as QueueEntry<DataRecord>);
            return structuredClone(created.record);
        }

        existing.record.data = args.mergeData
            ? args.mergeData(existing.record.data, args.record.data)
            : structuredClone(args.record.data);
        existing.options = args.options;
        existing.mergeData = args.mergeData;
        existing.version++;
        this.schedule(existing as QueueEntry<DataRecord>);
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
        const entry = this.entries.get(key);
        if (!entry) return;
        this.clearTimers(entry);
        this.entries.delete(key);
    }

    private getKey(tableName: TableName, id: string): QueueKey {
        return `${tableName}:${id}`;
    }

    private schedule(entry: QueueEntry<DataRecord>): void {
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

    private clearTimers(entry: QueueEntry<DataRecord>): void {
        if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
            entry.flushTimer = null;
        }
        if (entry.maxWaitTimer) {
            clearTimeout(entry.maxWaitTimer);
            entry.maxWaitTimer = null;
        }
    }

    private async flushKey(key: QueueKey): Promise<void> {
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

export const writeQueue = new WriteQueue();
