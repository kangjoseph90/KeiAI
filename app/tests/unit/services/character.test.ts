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

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

vi.mock('$lib/services/user', () => ({
    UserService: {}
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    }),
    canAccessScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return (
            (record.scopeType === 'user' && record.scopeId === 'user-123') ||
            (record.scopeType === 'room' && record.scopeId === 'room-123')
        );
    })
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

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        deleteOwnerAssets: vi.fn()
    }
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

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB, type DataRecord } from '$lib/adapters/db';
import { generateId } from '$lib/utils/id';
import { deepMerge } from '$lib/utils/defaults';
import { buffer } from '$lib/services/content/record_buffer';

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
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    describe('list', () => {
        it('should return list of characters with parsed fields', async () => {
            const mockRecords = [
                {
                    id: 'char-1',
                    scopeType: 'user' as const,
                    scopeId: mockUserId,
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    data: { name: 'Character 1', shortDescription: 'Desc 1' }
                },
                {
                    id: 'char-2',
                    scopeType: 'user' as const,
                    scopeId: mockUserId,
                    createdAt: 2000,
                    updatedAt: 2000,
                    isDeleted: false,
                    data: { name: 'Character 2', shortDescription: 'Desc 2' }
                }
            ];

            vi.mocked(localDB.getAll).mockResolvedValue(mockRecords);

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

        it('should call getAll with correct table name and user scope', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([]);

            await CharacterService.list();

            expect(localDB.getAll).toHaveBeenCalledWith('characters', {
                scopeType: 'user',
                scopeId: mockUserId
            });
        });
    });

    describe('get', () => {
        it('should return character when record exists', async () => {
            const mockRecord = {
                id: 'char-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: {
                    name: 'Test Char',
                    description: 'Test',
                    characterNote: 'Hello',
                    greetings: { '1': { id: '1', content: 'Hi', sortOrder: 'a' } }
                }
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await CharacterService.get('char-1');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('char-1');
            expect(result?.name).toBe('Test Char');
            expect(result?.characterNote).toBe('Hello');
        });

        it('should return null when record does not exist', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            const result = await CharacterService.get('non-existent');

            expect(result).toBeNull();
        });

        it('should return null when record is deleted', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: 'char-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: true,
                data: { name: 'Deleted' }
            } as never);

            const result = await CharacterService.get('char-1');

            expect(result).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new character with encrypted data', async () => {
            const result = await CharacterService.create({
                name: 'New Character',
                description: 'A test character',
                characterNote: 'You are helpful',
                greetings: { '1': { id: '1', content: 'Hello!', sortOrder: 'a' } }
            });

            expect(result.id).toBe('test-id-123');
            expect(result.name).toBe('New Character');
            expect(result.characterNote).toBe('You are helpful');
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'characters',
                expect.objectContaining({
                    id: 'test-id-123',
                    scopeType: 'user',
                    scopeId: mockUserId
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
            expect(result.characterNote).toBe('');
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
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: { name: 'Old Name', description: 'Old', characterNote: '' }
            };

            vi.mocked(buffer.get).mockResolvedValue(existingRecord as never);

            const result = await CharacterService.update('char-1', {
                name: 'New Name'
            });

            expect(result.name).toBe('New Name');
            expect(buffer.update).toHaveBeenCalled();
        });

        it('should throw NOT_FOUND when character does not exist', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            await expect(
                CharacterService.update('non-existent', { name: 'New' })
            ).rejects.toThrow();
        });

        it('should throw NOT_FOUND when character is deleted', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: 'char-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: true,
                data: { name: 'Deleted' }
            } as never);

            await expect(CharacterService.update('char-1', { name: 'New' })).rejects.toThrow();
        });
    });

    describe('delete', () => {
        const mockCharacter = {
            id: 'char-1',
            scopeType: 'user',
            scopeId: mockUserId,
            isDeleted: false,
            data: { name: 'Delete Me' }
        };

        beforeEach(() => {
            vi.mocked(buffer.get).mockResolvedValue(mockCharacter as never);
            vi.mocked(localDB.getByIndex).mockResolvedValue([
                { id: 'child-1', isDeleted: false }
            ] as unknown as DataRecord[]);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                await callback();
            });
        });

        it('should soft delete character and related data', async () => {
            await CharacterService.delete('char-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                expect.arrayContaining(['characters', 'lorebooks', 'scripts', 'charjs']),
                'rw',
                expect.any(Function)
            );
        });

        it('should soft delete character-owned resources but not room chats', async () => {
            await CharacterService.delete('char-1');

            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'lorebooks',
                'ownerId',
                'char-1',
                undefined
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'scripts',
                'ownerId',
                'char-1',
                undefined
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'charjs',
                'ownerId',
                'char-1',
                undefined
            );
            expect(localDB.softDeleteByIndex).not.toHaveBeenCalledWith(
                'messages',
                'chatId',
                expect.any(String),
                expect.anything()
            );
        });
    });
});
