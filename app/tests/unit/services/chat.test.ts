/**
 * Chat Service Tests
 *
 * Tests the ChatService which handles chat CRUD operations
 * with encryption and database writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '$lib/services/content/chat';
import type { Chat, ChatFields } from '$lib/services/content/chat';
import type { BaseRecord } from '$lib/adapters/db/types';

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getByIndex: vi.fn(),
        getRecord: vi.fn(),
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
    deepMerge: vi.fn((target: unknown, source: unknown) => {
        if (
            typeof target === 'object' &&
            target !== null &&
            typeof source === 'object' &&
            source !== null
        ) {
            return { ...target, ...source };
        }
        return source ?? target;
    })
}));

vi.mock('$lib/services/content/write_queue', () => ({
    writeQueue: {
        peek: vi.fn(() => null),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { generateId } from '$lib/utils/id';
import { deepMerge } from '$lib/utils/defaults';
import { writeQueue } from '$lib/services/content/write_queue';

describe('ChatService', () => {
    const mockMasterKey = {} as CryptoKey;
    const mockUserId = 'user-123';
    const mockEncryptedData = new Uint8Array([1, 2, 3]);
    const mockIV = new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    beforeEach(() => {
        vi.clearAllMocks();

        // Default session mock
        vi.mocked(getActiveSession).mockReturnValue({
            masterKey: mockMasterKey,
            userId: mockUserId,
            isGuest: false,
            identityKeyPair: {} as CryptoKeyPair
        });

        // Default encrypt mock
        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: mockEncryptedData,
            iv: mockIV
        });

        // Default decrypt mock
        vi.mocked(decrypt).mockResolvedValue(
            JSON.stringify({ title: 'Test Chat', messageCount: 0 })
        );

        // Default deepMerge mock
        vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
            ...(target as Record<string, unknown>),
            ...(source as Record<string, unknown>)
        }));

        // Default generateId mock
        vi.mocked(generateId).mockReturnValue('test-chat-id');

        // Default write queue mock
        vi.mocked(writeQueue.peek).mockReturnValue(null);
        vi.mocked(writeQueue.flushTable).mockResolvedValue(undefined);
    });

    describe('listByCharacter', () => {
        it('should return list of chats for a character', async () => {
            const mockRecords = [
                {
                    id: 'chat-1',
                    characterId: 'char-1',
                    userId: mockUserId,
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    data: { title: 'Chat 1', messageCount: 0 }
                } as unknown as BaseRecord,
                {
                    id: 'chat-2',
                    characterId: 'char-1',
                    userId: mockUserId,
                    createdAt: 2000,
                    updatedAt: 2000,
                    isDeleted: false,
                    data: { title: 'Chat 2', messageCount: 0 }
                } as unknown as BaseRecord
            ] as BaseRecord[];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

            const result = await ChatService.listByCharacter('char-1');

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('chat-1');
            expect(result[0].title).toBe('Chat 1');
            expect(result[1].id).toBe('chat-2');
            expect(result[1].title).toBe('Chat 2');
        });

        it('should return empty array when no chats exist', async () => {
            vi.mocked(localDB.getByIndex).mockResolvedValue([]);

            const result = await ChatService.listByCharacter('char-1');

            expect(result).toEqual([]);
        });

        it('should call getByIndex with correct parameters', async () => {
            vi.mocked(localDB.getByIndex).mockResolvedValue([]);

            await ChatService.listByCharacter('char-123');

            expect(localDB.getByIndex).toHaveBeenCalledWith(
                'chats',
                'characterId',
                'char-123',
                Number.MAX_SAFE_INTEGER
            );
        });
    });

    describe('get', () => {
        it('should return chat when record exists', async () => {
            const mockRecord = {
                id: 'chat-1',
                characterId: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: {
                    title: 'Test Chat',
                    messageCount: 0,
                    systemPromptOverride: 'Override'
                }
            } as unknown as BaseRecord;

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await ChatService.get('chat-1');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('chat-1');
            expect(result?.title).toBe('Test Chat');
            expect(result?.systemPromptOverride).toBe('Override');
        });

        it('should return null when record does not exist', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            const result = await ChatService.get('non-existent');

            expect(result).toBeNull();
        });

        it('should return null when record is deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'chat-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: true,
                data: { title: 'Deleted' }
            } as unknown as BaseRecord);

            const result = await ChatService.get('chat-1');

            expect(result).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new chat for a character', async () => {
            const result = await ChatService.create('char-1', { title: 'New Chat' });

            expect(result.id).toBe('test-chat-id');
            expect(result.characterId).toBe('char-1');
            expect(result.title).toBe('New Chat');

            expect(localDB.putRecord).toHaveBeenCalledWith(
                'chats',
                expect.objectContaining({
                    id: 'test-chat-id',
                    userId: mockUserId,
                    characterId: 'char-1'
                })
            );
        });

        it('should use default values when not provided', async () => {
            vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
                ...(target as Record<string, unknown>),
                ...(source as Record<string, unknown>)
            }));

            const result = await ChatService.create('char-1');

            expect(result.title).toBe('New Chat');
        });
    });

    describe('update', () => {
        it('should update chat fields', async () => {
            const existingRecord = {
                id: 'chat-1',
                characterId: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: { title: 'Old Title', messageCount: 5 }
            } as unknown as BaseRecord;

            vi.mocked(localDB.getRecord).mockResolvedValue(existingRecord);

            const result = await ChatService.update('chat-1', { title: 'New Title' });

            expect(result.title).toBe('New Title');
            expect(writeQueue.update).toHaveBeenCalled();
        });

        it('should throw NOT_FOUND when chat does not exist', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            await expect(ChatService.update('non-existent', { title: 'New' })).rejects.toThrow();
        });
    });

    describe('delete', () => {
        it('should soft delete chat and related data', async () => {
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });

            await ChatService.delete('chat-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                ['lorebooks', 'scripts', 'messages', 'chats', 'tool_calls', 'translations'],
                'rw',
                expect.any(Function)
            );
        });

        it('should soft delete related lorebooks, scripts, and messages', async () => {
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });

            await ChatService.delete('chat-1');

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
        });
    });
});
