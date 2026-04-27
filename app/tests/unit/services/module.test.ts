/**
 * Module Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleService, type ModuleFields } from '$lib/services/content/module';
import type { ModuleRecord, BaseRecord } from '$lib/adapters/db';
import { AppError } from '$lib/types/errors';

// Mock dependencies
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
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn(),
        transaction: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-module-id')
}));

vi.mock('$lib/services/content/write_queue', () => ({
    writeQueue: {
        peek: vi.fn(() => undefined),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';

describe('ModuleService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;

    const defaultFields: ModuleFields = {
        name: 'Test Module',
        description: 'Test Description',
        allowLowLevel: false
    };

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([1, 2, 3]),
            iv: new Uint8Array([4, 5, 6])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(defaultFields));
    });

    describe('list', () => {
        it('should return decrypted modules for active user', async () => {
            const mockRecords: ModuleRecord[] = [
                {
                    id: 'mod-1',
                    userId: mockUserId,
                    createdAt: 100,
                    updatedAt: 100,
                    isDeleted: false,
                    data: defaultFields as unknown as Record<string, unknown> as unknown as Record<
                        string,
                        unknown
                    >
                }
            ];

            vi.mocked(localDB.getAll).mockResolvedValue(mockRecords);

            const result = await ModuleService.list();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('mod-1');
            expect(result[0].name).toBe('Test Module');
            expect(localDB.getAll).toHaveBeenCalledWith('modules', mockUserId);
        });
    });

    describe('get', () => {
        it('should return decrypted module detail', async () => {
            const mockRecord: ModuleRecord = {
                id: 'mod-1',
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await ModuleService.get('mod-1');

            expect(result?.id).toBe('mod-1');
            expect(result?.name).toBe('Test Module');
        });

        it('should return null if missing or deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);
            expect(await ModuleService.get('missing')).toBeNull();

            vi.mocked(localDB.getRecord).mockResolvedValue({ isDeleted: true } as ModuleRecord);
            expect(await ModuleService.get('deleted')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new module', async () => {
            const result = await ModuleService.create({ name: 'New Module' });

            expect(result.id).toBe('test-module-id');
            expect(result.name).toBe('New Module');
            expect(localDB.putRecord).toHaveBeenCalled();
        });

        it('should throw AppError on failure', async () => {
            vi.mocked(localDB.putRecord).mockRejectedValue(new Error('Fail'));
            await expect(ModuleService.create()).rejects.toThrow(AppError);
        });
    });

    describe('update', () => {
        it('should update and merge module fields', async () => {
            const mockRecord: ModuleRecord = {
                id: 'mod-1',
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await ModuleService.update('mod-1', { description: 'Updated' });

            expect(result.description).toBe('Updated');
            expect(result.name).toBe('Test Module'); // Preserved
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should delete module and its contents in a transaction', async () => {
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                return callback();
            });

            await ModuleService.delete('mod-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                ['lorebooks', 'scripts', 'charjs', 'modules'],
                'rw',
                expect.any(Function)
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('lorebooks', 'ownerId', 'mod-1');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('scripts', 'ownerId', 'mod-1');
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('charjs', 'ownerId', 'mod-1');
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('modules', 'mod-1');
        });
    });
});
