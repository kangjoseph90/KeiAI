import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buffer } from '$lib/services/content/record_buffer';
import { localDB, type DataRecord, type DatabaseWriteEvent } from '$lib/adapters/db';

const mockState = vi.hoisted(() => ({
    writeEventListener: undefined as ((events: DatabaseWriteEvent[]) => void) | undefined
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        subscribeWriteEvents: vi.fn((listener) => {
            mockState.writeEventListener = listener;
            return vi.fn();
        })
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

describe('recordBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
        buffer.drop('messages', 'msg-1');
    });

    afterEach(() => {
        buffer.drop('messages', 'msg-1');
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

        buffer.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first' } }),
            patch: { content: 'first' }
        });

        const flushPromise = buffer.flush('messages', 'msg-1');
        expect(localDB.putRecord).toHaveBeenCalledTimes(1);

        buffer.update<DataRecord>({
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

    it('get returns full record with metadata', async () => {
        const record = makeRecord({ data: { content: 'hello' } });

        buffer.update<DataRecord>({
            tableName: 'messages',
            record,
            patch: record.data
        });

        const cached = await buffer.get<DataRecord>('messages', 'msg-1');
        expect(cached).toEqual(record);
        expect(cached?.userId).toBe('user-1');
        expect(cached?.createdAt).toBe(100);
    });

    it('get returns null when nothing is queued', async () => {
        const cached = await buffer.get<DataRecord>('messages', 'msg-1');
        expect(cached).toBeNull();
    });

    it('invalidates read cache when localDB emits a write event', async () => {
        vi.mocked(localDB.getRecord)
            .mockResolvedValueOnce(makeRecord({ data: { content: 'old' } }))
            .mockResolvedValueOnce(makeRecord({ data: { content: 'new' } }));

        expect((await buffer.get<DataRecord>('messages', 'msg-1'))?.data).toEqual({
            content: 'old'
        });

        mockState.writeEventListener?.([
            { tableName: 'messages', operation: 'put', ids: ['msg-1'], origin: 'sync' }
        ]);

        expect((await buffer.get<DataRecord>('messages', 'msg-1'))?.data).toEqual({
            content: 'new'
        });
    });

    it('update seeds the queue with the full record when no pending entry exists', async () => {
        buffer.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first', extra: 1 } }),
            patch: { content: 'ignored' }
        });

        const cached = await buffer.get<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({ content: 'first', extra: 1 });
    });

    it('update merges only the patch when a pending entry exists', async () => {
        buffer.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'first', extra: 1 } }),
            patch: { content: 'first', extra: 1 }
        });

        buffer.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord({ data: { content: 'second', stale: true } }),
            patch: { content: 'second' }
        });

        const cached = await buffer.get<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({ content: 'second', extra: 1 });
    });

    it('update preserves nested object keys when merging patches', async () => {
        buffer.update<DataRecord>({
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

        buffer.update<DataRecord>({
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

        const cached = await buffer.get<DataRecord>('messages', 'msg-1');
        expect(cached?.data).toEqual({
            swipes: {
                s1: { content: 'first' },
                s2: { content: 'second' }
            }
        });
    });

    it('drop removes entry from queue', async () => {
        buffer.update<DataRecord>({
            tableName: 'messages',
            record: makeRecord(),
            patch: makeRecord().data
        });

        buffer.drop('messages', 'msg-1');
        expect(await buffer.get<DataRecord>('messages', 'msg-1')).toBeNull();
    });
});
