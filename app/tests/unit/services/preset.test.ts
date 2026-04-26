/**
 * Preset Service Tests
 *
 * Tests the PresetService which manages generation parameter presets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PresetService, type PresetFields } from '$lib/services/content/preset';
import { getActiveSession } from '$lib/services/session';
import { localDB, type PresetRecord } from '$lib/adapters/db';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/types/errors';

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
        softDeleteRecord: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'preset-123')
}));

vi.mock('$lib/services/content/write_queue', () => ({
    writeQueue: {
        peek: vi.fn(() => null),
        upsert: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { writeQueue } from '$lib/services/content/write_queue';

describe('PresetService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;
    const mockNow = 1710000000000;

    const mockFields: PresetFields = {
        name: 'Test Preset',
        description: 'Test Description',
        chatModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: { temperature: 0.9 } },
        auxModel: { id: '', provider: 'openai', parameters: {} },
        templateOrder: [],
        maxResponse: 600,
        maxContext: 4096
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

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            isGuest: false,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([0]),
            iv: new Uint8Array([0])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(mockFields));

        vi.mocked(writeQueue.peek).mockReturnValue(null);
        vi.mocked(writeQueue.flushTable).mockResolvedValue(undefined);
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
            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await PresetService.get('preset-123');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('preset-123');
            expect(result?.name).toBe(mockFields.name);
            expect(result?.chatModel.id).toBe(mockFields.chatModel.id);
        });

        it('should return null if record is missing', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
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
            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await PresetService.update('preset-123', {
                name: 'New Name',
                maxResponse: 800
            });

            expect(result.name).toBe('New Name');
            expect(result.maxResponse).toBe(800);

            expect(writeQueue.upsert).toHaveBeenCalled();
        });

        it('should throw if record not found', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
            await expect(PresetService.update('none', {})).rejects.toThrow(AppError);
        });
    });

    describe('delete', () => {
        it('should soft delete the record', async () => {
            await PresetService.delete('preset-123');
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('presets', 'preset-123');
        });
    });
});
