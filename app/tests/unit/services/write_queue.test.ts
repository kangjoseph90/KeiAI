import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeQueue } from '$lib/services/content/write_queue';
import { localDB, type DataRecord } from '$lib/adapters/db';

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        putRecord: vi.fn()
    }
}));

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

        const toRecord = ({
            id,
            userId,
            createdAt,
            updatedAt,
            data
        }: {
            id: string;
            userId: string;
            createdAt: number;
            updatedAt: number;
            data: Record<string, unknown>;
        }): DataRecord => ({
            id,
            userId,
            createdAt,
            updatedAt,
            isDeleted: false,
            data
        });

        writeQueue.upsert({
            tableName: 'messages',
            id: 'msg-1',
            userId: 'user-1',
            createdAt: 100,
            nextFields: { content: 'first' },
            toRecord
        });

        const flushPromise = writeQueue.flush('messages', 'msg-1');
        expect(localDB.putRecord).toHaveBeenCalledTimes(1);

        writeQueue.upsert({
            tableName: 'messages',
            id: 'msg-1',
            userId: 'user-1',
            createdAt: 100,
            nextFields: { content: 'second' },
            toRecord
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
});
