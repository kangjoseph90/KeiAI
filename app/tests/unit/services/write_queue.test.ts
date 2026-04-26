import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeQueue } from '$lib/services/content/write_queue';
import { localDB, type DataRecord } from '$lib/adapters/db';

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        putRecord: vi.fn()
    }
}));

function makeRecord(overrides: Partial<DataRecord> = {}): DataRecord {
    return {
        id: 'msg-1',
        userId: 'user-1',
        createdAt: 100,
        updatedAt: 100,
        isDeleted: false,
        data: { content: 'first' },
        ...overrides
    };
}

describe('writeQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        writeQueue.drop('messages', 'msg-1');
    });

    afterEach(() => {
        writeQueue.drop('messages', 'msg-1');
        vi.useRealTimers();
    });

    it('keeps updates queued when they arrive during an in-flight flush', async () => {
        let resolveFirstWrite: (() => void) | undefined;
        vi.mocked(localDB.putRecord)
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveFirstWrite = resolve;
                    })
            )
            .mockResolvedValue(undefined);

        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first' } }),
            patch: { content: 'first' }
        });

        const flushPromise = writeQueue.flush('messages', 'msg-1');
        expect(localDB.putRecord).toHaveBeenCalledTimes(1);

        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'second' } }),
            patch: { content: 'second' }
        });

        resolveFirstWrite?.();
        await flushPromise;

        await vi.runOnlyPendingTimersAsync();

        expect(localDB.putRecord).toHaveBeenNthCalledWith(
            1,
            'messages',
            expect.objectContaining({
                data: { content: 'first' }
            }),
            undefined
        );
        expect(localDB.putRecord).toHaveBeenNthCalledWith(
            2,
            'messages',
            expect.objectContaining({
                data: { content: 'second' }
            }),
            undefined
        );
    });

    it('peek returns full record with metadata', () => {
        const record = makeRecord({ data: { content: 'hello' } });

        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record,
            patch: record.data
        });

        const cached = writeQueue.peek<DataRecord>('messages', 'msg-1');
        expect(cached).toEqual(record);
        expect(cached?.userId).toBe('user-1');
        expect(cached?.createdAt).toBe(100);
    });

    it('peek returns null when nothing is queued', () => {
        const cached = writeQueue.peek<DataRecord>('messages', 'msg-1');
        expect(cached).toBeNull();
    });

    it('update seeds the queue with the full record when no pending entry exists', () => {
        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first', extra: 1 } }),
            patch: { content: 'ignored' }
        });

        const cached = writeQueue.peek<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({ content: 'first', extra: 1 });
    });

    it('update merges only the patch when a pending entry exists', () => {
        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first', extra: 1 } }),
            patch: { content: 'first', extra: 1 }
        });

        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'second', stale: true } }),
            patch: { content: 'second' }
        });

        const cached = writeQueue.peek<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({ content: 'second', extra: 1 });
    });

    it('update preserves nested object keys when merging patches', () => {
        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({
                data: {
                    swipes: {
                        s1: { content: 'first' }
                    }
                }
            }),
            patch: {
                swipes: {
                    s1: { content: 'first' }
                }
            }
        });

        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({
                data: {
                    swipes: {
                        s2: { content: 'second' }
                    }
                }
            }),
            patch: {
                swipes: {
                    s2: { content: 'second' }
                }
            }
        });

        const cached = writeQueue.peek<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({
            swipes: {
                s1: { content: 'first' },
                s2: { content: 'second' }
            }
        });
    });

    it('drop removes entry from queue', () => {
        writeQueue.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord(),
            patch: makeRecord().data
        });

        writeQueue.drop('messages', 'msg-1');
        expect(writeQueue.peek<DataRecord>('messages', 'msg-1')).toBeNull();
    });
});
