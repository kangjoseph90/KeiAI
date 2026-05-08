/**
 * Preset Service Tests
 *
 * Tests the PresetService which manages generation parameter presets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PresetService, type PresetFields } from '$lib/services/content/preset';
import { getActiveSession, UserService } from '$lib/services/user';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/types/errors';

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
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn(),
        transaction: vi.fn((_tables, _mode, cb) => cb())
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'preset-123')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { buffer } from '$lib/services/content/record_buffer';

describe('PresetService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;
    const mockNow = 1710000000000;

    const mockFields: PresetFields = {
        name: 'Test Preset',
        description: 'Test Description',
        chatModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: { temperature: 0.9 } },
        auxModel: { id: '', provider: 'openai', parameters: {} },
        promptBlocks: {},
        maxResponse: 600,
        maxContext: 4096,
        lorebookRatio: 0.2,
        memoryRatio: 0.2
    };

    const mockRecord: PresetRecord = {
        id: 'preset-123',
        userId: mockUserId,
        createdAt: mockNow,
        updatedAt: mockNow,
        isDeleted: false,
        data: mockFields as unknown as Record<string, unknown>
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([0]),
            iv: new Uint8Array([0])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(mockFields));
    });

    describe('list', () => {
        it('should list all presets', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([mockRecord]);

            const result = await PresetService.list();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe(mockFields.name);
            expect(localDB.getAll).toHaveBeenCalledWith('presets', mockUserId);
        });
    });

    describe('get', () => {
        it('should return full preset', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await PresetService.get('preset-123');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('preset-123');
            expect(result?.name).toBe(mockFields.name);
            expect(result?.chatModel.id).toBe(mockFields.chatModel.id);
        });

        it('should return null if record is missing', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await PresetService.get('none')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a preset record', async () => {
            const result = await PresetService.create(mockFields);

            expect(result.id).toBe('preset-123');
            expect(localDB.putRecord).toHaveBeenCalledTimes(1);
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'presets',
                expect.objectContaining({
                    id: 'preset-123',
                    userId: mockUserId
                })
            );
        });
    });

    describe('update', () => {
        it('should update preset correctly', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await PresetService.update('preset-123', {
                name: 'New Name',
                maxResponse: 800
            });

            expect(result.name).toBe('New Name');
            expect(result.maxResponse).toBe(800);

            expect(buffer.update).toHaveBeenCalled();
        });

        it('should throw if record not found', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            await expect(PresetService.update('none', {})).rejects.toThrow(AppError);
        });
    });

    describe('delete', () => {
        it('should soft delete the record and its owned scripts', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            await PresetService.delete('preset-123');
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('presets', 'preset-123');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'scripts',
                'ownerId',
                'preset-123'
            );
        });
    });
});
