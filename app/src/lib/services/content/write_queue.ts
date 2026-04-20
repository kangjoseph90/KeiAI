import { encrypt } from '$lib/crypto';
import {
    localDB,
    type DatabaseWriteOptions,
    type EncryptedRecord,
    type TableName
} from '$lib/adapters/db';
import { getActiveSession } from '../session';
import { AppError } from '$lib/types/errors';

const WRITE_DEBOUNCE_MS = 400;
const WRITE_MAX_WAIT_MS = 2000;

type QueueKey = `${TableName}:${string}`;

interface QueueEntry<TFields, TRecord extends EncryptedRecord> {
    key: QueueKey;
    tableName: TableName;
    id: string;
    userId: string;
    createdAt: number;
    fields: TFields;
    options?: DatabaseWriteOptions;
    toRecord: (payload: {
        id: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        encryptedData: Uint8Array<ArrayBuffer>;
        encryptedDataIV: Uint8Array<ArrayBuffer>;
    }) => TRecord;
    flushTimer: ReturnType<typeof setTimeout> | null;
    maxWaitTimer: ReturnType<typeof setTimeout> | null;
    firstQueuedAt: number;
    flushPromise: Promise<void> | null;
}

class EncryptedWriteQueue {
    private readonly entries = new Map<QueueKey, QueueEntry<unknown, EncryptedRecord>>();

    constructor() {
        this.installLifecycleFlushHooks();
    }

    peek<TFields>(tableName: TableName, id: string): TFields | null {
        const entry = this.entries.get(this.getKey(tableName, id));
        if (!entry) return null;
        return structuredClone(entry.fields) as TFields;
    }

    upsert<TFields, TRecord extends EncryptedRecord>(args: {
        tableName: TableName;
        id: string;
        userId: string;
        createdAt: number;
        nextFields: TFields;
        mergeFields?: (current: TFields, next: TFields) => TFields;
        options?: DatabaseWriteOptions;
        toRecord: QueueEntry<TFields, TRecord>['toRecord'];
    }): TFields {
        const key = this.getKey(args.tableName, args.id);
        const existing = this.entries.get(key) as QueueEntry<TFields, TRecord> | undefined;

        if (!existing) {
            const now = Date.now();
            const created: QueueEntry<TFields, TRecord> = {
                key,
                tableName: args.tableName,
                id: args.id,
                userId: args.userId,
                createdAt: args.createdAt,
                fields: structuredClone(args.nextFields),
                options: args.options,
                toRecord: args.toRecord,
                flushTimer: null,
                maxWaitTimer: null,
                firstQueuedAt: now,
                flushPromise: null
            };
            this.entries.set(key, created as QueueEntry<unknown, EncryptedRecord>);
            this.schedule(created as QueueEntry<unknown, EncryptedRecord>);
            return structuredClone(created.fields);
        }

        existing.fields = args.mergeFields
            ? args.mergeFields(existing.fields, args.nextFields)
            : structuredClone(args.nextFields);
        existing.options = args.options;
        existing.toRecord = args.toRecord;
        this.schedule(existing as QueueEntry<unknown, EncryptedRecord>);
        return structuredClone(existing.fields);
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

    private schedule(entry: QueueEntry<unknown, EncryptedRecord>): void {
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

    private clearTimers(entry: QueueEntry<unknown, EncryptedRecord>): void {
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

        this.clearTimers(entry);
        entry.flushPromise = (async () => {
            const { masterKey } = getActiveSession();
            const updatedAt = Date.now();
            const enc = await encrypt(masterKey, JSON.stringify(entry.fields));
            const record = entry.toRecord({
                id: entry.id,
                userId: entry.userId,
                createdAt: entry.createdAt,
                updatedAt,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            });

            await localDB.putRecord(entry.tableName, record, entry.options);
        })();

        try {
            await entry.flushPromise;
            this.entries.delete(key);
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

export const encryptedWriteQueue = new EncryptedWriteQueue();
