import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '$lib/services/content/chat';
import type { BaseRecord } from '$lib/adapters/db/types';

vi.mock('$lib/services/user', () => ({
    getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getByIndex: vi.fn(),
        putRecord: vi.fn(),
        transaction: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-chat-id')
}));

vi.mock('$lib/utils/defaults', () => ({
    deepMerge: vi.fn((target: unknown, source: unknown) => ({
        ...(target as Record<string, unknown>),
        ...(source as Record<string, unknown>)
    }))
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { getActiveSession } from '$lib/services/user';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('ChatService', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            masterKey: {} as CryptoKey,
            userId: mockUserId,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    describe('listByRoom', () => {
        it('returns chats for a room', async () => {
            vi.mocked(localDB.getByIndex).mockResolvedValue([
                {
                    id: 'chat-1',
                    roomId: 'room-1',
                    userId: mockUserId,
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    data: { title: 'Chat 1' }
                },
                {
                    id: 'chat-2',
                    roomId: 'room-1',
                    userId: mockUserId,
                    createdAt: 2000,
                    updatedAt: 2000,
                    isDeleted: false,
                    data: { title: 'Chat 2' }
                }
            ] as unknown as BaseRecord[]);

            const result = await ChatService.listByRoom('room-1');

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ id: 'chat-1', roomId: 'room-1', title: 'Chat 1' });
            expect(result[1]).toMatchObject({ id: 'chat-2', roomId: 'room-1', title: 'Chat 2' });
            expect(localDB.getByIndex).toHaveBeenCalledWith(
                'chats',
                'roomId',
                'room-1',
                Number.MAX_SAFE_INTEGER
            );
        });
    });

    describe('get', () => {
        it('returns a chat when record exists', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: 'chat-1',
                roomId: 'room-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: { title: 'Test Chat', chatNote: 'Override' }
            } as never);

            const result = await ChatService.get('chat-1');

            expect(result).toMatchObject({
                id: 'chat-1',
                roomId: 'room-1',
                title: 'Test Chat',
                chatNote: 'Override'
            });
        });

        it('returns null for missing or deleted records', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            await expect(ChatService.get('missing')).resolves.toBeNull();

            vi.mocked(buffer.get).mockResolvedValue({
                id: 'chat-1',
                roomId: 'room-1',
                userId: mockUserId,
                isDeleted: true,
                data: {}
            } as never);
            await expect(ChatService.get('chat-1')).resolves.toBeNull();
        });
    });

    describe('create', () => {
        it('creates a chat for a room', async () => {
            const result = await ChatService.create('room-1', { title: 'New Chat' });

            expect(result).toMatchObject({
                id: 'test-chat-id',
                roomId: 'room-1',
                title: 'New Chat'
            });
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'chats',
                expect.objectContaining({
                    id: 'test-chat-id',
                    userId: mockUserId,
                    roomId: 'room-1'
                })
            );
        });
    });

    describe('update', () => {
        it('updates chat fields', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: 'chat-1',
                roomId: 'room-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: { title: 'Old Title' }
            } as never);

            const result = await ChatService.update('chat-1', { title: 'New Title' });

            expect(result).toMatchObject({ id: 'chat-1', roomId: 'room-1', title: 'New Title' });
            expect(buffer.update).toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        beforeEach(() => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: 'chat-1',
                roomId: 'room-1',
                userId: mockUserId,
                isDeleted: false,
                data: { title: 'Delete Me' }
            } as never);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });
        });

        it('soft deletes chat-owned data and the chat', async () => {
            await ChatService.delete('chat-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                ['lorebooks', 'scripts', 'messages', 'chats', 'tool_calls', 'translations'],
                'rw',
                expect.any(Function)
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'lorebooks',
                'ownerId',
                'chat-1'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('scripts', 'ownerId', 'chat-1');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-1');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'tool_calls',
                'chatId',
                'chat-1'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'translations',
                'chatId',
                'chat-1'
            );
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('chats', 'chat-1');
        });
    });
});
