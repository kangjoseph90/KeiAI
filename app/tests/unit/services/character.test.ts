/**
 * Character Service Tests
 *
 * Tests the CharacterService which handles character CRUD operations
 * with encryption and database writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharacterService } from '$lib/services/content/character';
import type { Character, CharacterFields } from '$lib/services/content/character';
import type { AppError } from '$lib/types/errors';
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
        getAll: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        putRecords: vi.fn(),
        deleteRecord: vi.fn(),
        transaction: vi.fn(),
        getByIndex: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-id-123')
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
    encryptedWriteQueue: {
        peek: vi.fn(() => undefined),
        upsert: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { generateId } from '$lib/utils/id';
import { deepMerge } from '$lib/utils/defaults';
import { encryptedWriteQueue } from '$lib/services/content/write_queue';

describe('CharacterService', () => {
    const mockMasterKey = {} as CryptoKey;
    const mockUserId = 'user-123';
    const mockEncryptedData = new Uint8Array([1, 2, 3]);
    const mockIV = new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const mockNow = new Date('2023-01-01T12:00:00.000Z');

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);

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
            JSON.stringify({ name: 'Test Character', systemPrompt: 'Test prompt' })
        );

        // Default deepMerge mock
        vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
            ...(target as Record<string, unknown>),
            ...(source as Record<string, unknown>)
        }));

        // Default generateId mock
        vi.mocked(generateId).mockReturnValue('test-id-123');

        // Default write queue mock
        vi.mocked(encryptedWriteQueue.peek).mockReturnValue(undefined);
        vi.mocked(encryptedWriteQueue.flushTable).mockResolvedValue(undefined);
    });

    describe('list', () => {
        it('should return list of characters with decrypted fields', async () => {
            const mockRecords = [
                {
                    id: 'char-1',
                    userId: mockUserId,
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    encryptedData: new Uint8Array([1]),
                    encryptedDataIV: new Uint8Array([2])
                },
                {
                    id: 'char-2',
                    userId: mockUserId,
                    createdAt: 2000,
                    updatedAt: 2000,
                    isDeleted: false,
                    encryptedData: new Uint8Array([3]),
                    encryptedDataIV: new Uint8Array([4])
                }
            ];

            vi.mocked(localDB.getAll).mockResolvedValue(mockRecords);
            vi.mocked(decrypt)
                .mockResolvedValueOnce(
                    JSON.stringify({ name: 'Character 1', shortDescription: 'Desc 1' })
                )
                .mockResolvedValueOnce(
                    JSON.stringify({ name: 'Character 2', shortDescription: 'Desc 2' })
                );

            const result = await CharacterService.list();

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('char-1');
            expect(result[0].name).toBe('Character 1');
            expect(result[1].id).toBe('char-2');
            expect(result[1].name).toBe('Character 2');
        });

        it('should return empty array when no characters exist', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([]);

            const result = await CharacterService.list();

            expect(result).toEqual([]);
        });

        it('should call getAll with correct table name and userId', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([]);
            vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ name: 'Test' }));

            await CharacterService.list();

            expect(localDB.getAll).toHaveBeenCalledWith('characters', mockUserId);
        });
    });

    describe('get', () => {
        it('should return character when record exists', async () => {
            const mockRecord = {
                id: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                encryptedData: new Uint8Array([1]),
                encryptedDataIV: new Uint8Array([2])
            };

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
            vi.mocked(decrypt).mockResolvedValue(
                JSON.stringify({
                    name: 'Test Char',
                    shortDescription: 'Test',
                    systemPrompt: 'Hello',
                    greetingMessage: 'Hi'
                })
            );

            const result = await CharacterService.get('char-1');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('char-1');
            expect(result?.name).toBe('Test Char');
            expect(result?.systemPrompt).toBe('Hello');
        });

        it('should return null when record does not exist', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            const result = await CharacterService.get('non-existent');

            expect(result).toBeNull();
        });

        it('should return null when record is deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: true,
                encryptedData: new Uint8Array([1]),
                encryptedDataIV: new Uint8Array([2])
            } as unknown as BaseRecord);

            const result = await CharacterService.get('char-1');

            expect(result).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new character with encrypted data', async () => {
            const result = await CharacterService.create({
                name: 'New Character',
                shortDescription: 'A test character',
                systemPrompt: 'You are helpful',
                greetingMessage: 'Hello!'
            });

            expect(result.id).toBe('test-id-123');
            expect(result.name).toBe('New Character');
            expect(result.systemPrompt).toBe('You are helpful');
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'characters',
                expect.objectContaining({
                    id: 'test-id-123',
                    userId: mockUserId
                })
            );
        });

        it('should use default values when not provided', async () => {
            vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
                ...(target as Record<string, unknown>),
                ...(source as Record<string, unknown>)
            }));

            const result = await CharacterService.create();

            expect(result.name).toBe('New Character');
            expect(result.systemPrompt).toBe('');
        });

        it('should generate unique ID for each character', async () => {
            vi.mocked(generateId).mockReturnValueOnce('id-1').mockReturnValueOnce('id-2');

            const char1 = await CharacterService.create({ name: 'Char 1' });
            const char2 = await CharacterService.create({ name: 'Char 2' });

            expect(char1.id).toBe('id-1');
            expect(char2.id).toBe('id-2');
        });
    });

    describe('update', () => {
        it('should update character fields', async () => {
            const existingRecord = {
                id: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                encryptedData: new Uint8Array([1]),
                encryptedDataIV: new Uint8Array([2])
            };

            vi.mocked(localDB.getRecord).mockResolvedValue(existingRecord);
            vi.mocked(decrypt).mockResolvedValue(
                JSON.stringify({ name: 'Old Name', shortDescription: 'Old', systemPrompt: '' })
            );
            vi.mocked(encrypt).mockResolvedValue({
                ciphertext: new Uint8Array([99]),
                iv: new Uint8Array([88])
            });

            const result = await CharacterService.update('char-1', {
                name: 'New Name'
            });

            expect(result.name).toBe('New Name');
            expect(encryptedWriteQueue.upsert).toHaveBeenCalled();
        });

        it('should throw NOT_FOUND when character does not exist', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            await expect(
                CharacterService.update('non-existent', { name: 'New' })
            ).rejects.toThrow();
        });

        it('should throw NOT_FOUND when character is deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'char-1',
                userId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: true,
                encryptedData: new Uint8Array([1]),
                encryptedDataIV: new Uint8Array([2])
            } as unknown as BaseRecord);

            await expect(CharacterService.update('char-1', { name: 'New' })).rejects.toThrow();
        });
    });

    describe('delete', () => {
        it('should soft delete character and related data', async () => {
            vi.mocked(localDB.getByIndex).mockResolvedValue([]);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });

            await CharacterService.delete('char-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                [
                    'chats',
                    'lorebooks',
                    'scripts',
                    'messages',
                    'tool_calls',
                    'translations',
                    'characters',
                    'charjs'
                ],
                'rw',
                expect.any(Function)
            );
        });

        it('should soft delete related chats', async () => {
            const mockChats = [
                { id: 'chat-1', characterId: 'char-1' },
                { id: 'chat-2', characterId: 'char-1' }
            ] as unknown as BaseRecord[];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockChats);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });

            await CharacterService.delete('char-1');

            // Should call softDeleteByIndex for messages, lorebooks, scripts for each chat
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-1');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-2');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'tool_calls',
                'chatId',
                'chat-1'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'tool_calls',
                'chatId',
                'chat-2'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'translations',
                'chatId',
                'chat-1'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'translations',
                'chatId',
                'chat-2'
            );
        });

        it('should soft delete related tool calls for each chat', async () => {
            const mockChats = [{ id: 'chat-a', characterId: 'char-1' }] as unknown as BaseRecord[];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockChats);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });

            await CharacterService.delete('char-1');

            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'tool_calls',
                'chatId',
                'chat-a'
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'translations',
                'chatId',
                'chat-a'
            );
        });
    });
});
