/**
 * Persona Service Tests
 *
 * Tests the PersonaService which manages persona creation, updates, and deletion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonaService, type PersonaFields } from '$lib/services/content/persona';
import { getActiveSession, UserService } from '$lib/services/user';
import { localDB, type PersonaRecord } from '$lib/adapters/db';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { buffer } from '$lib/services/content/record_buffer';

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

vi.mock('$lib/services/user', () => ({
    UserService: {},
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getAll: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'persona-123')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

describe('PersonaService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;
    const mockNow = 1710000000000;

    const basePersonaFields: PersonaFields = {
        name: 'Test Persona',
        description: 'Test Description',
        assets: []
    };

    const mockRecord: PersonaRecord = {
        id: 'persona-123',
        userId: mockUserId,
        createdAt: mockNow,
        updatedAt: mockNow,
        isDeleted: false,
        data: basePersonaFields as unknown as Record<string, unknown>
    };

    beforeEach(() => {
        vi.resetAllMocks(); // Use reset instead of clear for cleaner state
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
        buffer.drop('personas', 'persona-123');

        // Default session mock
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        // Default crypto mocks
        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([1, 2, 3]),
            iv: new Uint8Array([4, 5, 6])
        });
        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(basePersonaFields));
    });

    describe('list', () => {
        it('should list and decrypt all personas for the active user', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([mockRecord]);

            const result = await PersonaService.list();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: 'persona-123',
                ...basePersonaFields
            });
        });
    });

    describe('get', () => {
        it('should return a persona by id', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            const result = await PersonaService.get('persona-123');
            expect(result?.name).toBe(basePersonaFields.name);
        });

        it('should return null if missing', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await PersonaService.get('none')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a persona', async () => {
            const result = await PersonaService.create({ name: 'New' });
            expect(result.name).toBe('New');
            expect(localDB.putRecord).toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('should update fields', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            const result = await PersonaService.update('persona-123', { name: 'Updated' });
            expect(result.name).toBe('Updated');

            expect(buffer.update).toHaveBeenCalled();
        });

        it('should throw AppError when record not found', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            await expect(PersonaService.update('persona-123', { name: 'Fail' })).rejects.toThrow(
                AppError
            );
        });
    });

    describe('delete', () => {
        it('should soft delete', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            await PersonaService.delete('persona-123');
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('personas', 'persona-123');
        });
    });
});
