import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '$lib/services/content/file';
import type { FileRecord } from '$lib/adapters/db';

vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => ({
        scopeType,
        scopeId: scopeType === 'user' ? 'user-1' : 'room-1'
    })),
    canAccessScope: vi.fn(() => true)
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getByIndex: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'file-1')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

const record: FileRecord = {
    id: 'file-1',
    scopeType: 'user',
    scopeId: 'user-1',
    ownerId: 'chat-1',
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    data: {
        namespace: 'chat',
        path: 'notes/summary.txt',
        content: 'old content'
    }
};

describe('FileService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(localDB.getByIndex).mockResolvedValue([]);
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    it('reads a file by namespace and path', async () => {
        vi.mocked(localDB.getByIndex).mockResolvedValue([record]);

        await expect(FileService.getByPath('chat', 'chat-1', 'notes/summary.txt')).resolves.toEqual(
            expect.objectContaining({
                id: 'file-1',
                namespace: 'chat',
                namespaceId: 'chat-1',
                content: 'old content'
            })
        );
        expect(localDB.getByIndex).toHaveBeenCalledWith(
            'files',
            'ownerId',
            'chat-1',
            Number.MAX_SAFE_INTEGER
        );
    });

    it('creates a file in the resolved data scope', async () => {
        const created = await FileService.create(
            'room',
            'room-1',
            { path: ' shared.txt ', content: 'hello' },
            'room'
        );

        expect(created).toMatchObject({
            id: 'file-1',
            namespace: 'room',
            namespaceId: 'room-1',
            path: 'shared.txt',
            content: 'hello',
            scopeType: 'room',
            scopeId: 'room-1'
        });
        expect(localDB.putRecord).toHaveBeenCalledWith(
            'files',
            expect.objectContaining({
                id: 'file-1',
                ownerId: 'room-1',
                scopeType: 'room',
                data: {
                    namespace: 'room',
                    path: 'shared.txt',
                    content: 'hello'
                }
            })
        );
    });

    it('updates an existing file through the write buffer', async () => {
        vi.mocked(buffer.get).mockResolvedValue(record);

        const updated = await FileService.update('file-1', { content: 'new content' });

        expect(updated.content).toBe('new content');
        expect(buffer.update).toHaveBeenCalledWith(
            expect.objectContaining({
                tableName: 'files',
                record: expect.objectContaining({
                    data: expect.objectContaining({ content: 'new content' })
                })
            })
        );
        expect(localDB.putRecord).not.toHaveBeenCalled();
    });

    it('upserts an existing path instead of creating a duplicate', async () => {
        vi.mocked(localDB.getByIndex).mockResolvedValue([record]);
        vi.mocked(buffer.get).mockResolvedValue(record);

        const updated = await FileService.upsert(
            'chat',
            'chat-1',
            'notes/summary.txt',
            'replacement'
        );

        expect(updated.content).toBe('replacement');
        expect(buffer.update).toHaveBeenCalledTimes(1);
        expect(localDB.putRecord).not.toHaveBeenCalled();
    });

    it('rejects an empty path', async () => {
        await expect(FileService.getByPath('global', 'user-1', '  ')).rejects.toThrow(
            'File path is required'
        );
    });
});
