/**
 * Module Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleService, type ModuleFields } from '$lib/services/content/module';
import type { ModuleRecord, DataRecord } from '$lib/adapters/db';
import { AppError } from '$lib/types/errors';

// Mock dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    }),
    canAccessScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return (
            (record.scopeType === 'user' && record.scopeId === 'user-123') ||
            (record.scopeType === 'room' && record.scopeId === 'room-123')
        );
    }),
    canAccessUserScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return record.scopeType === 'user' && record.scopeId === 'user-123';
    })
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getAll: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn(),
        getByIndex: vi.fn().mockResolvedValue([]),
        transaction: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-module-id')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        deleteOwnerAssets: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('ModuleService', () => {
    const mockUserId = 'user-123';
    const defaultFields: ModuleFields = {
        name: 'Test Module',
        description: 'Test Description',
        backgroundHTML: '',
        messageCSS: '',
        defaultVariables: {},
        allowLowLevel: false,
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: { refs: {}, folders: {} }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

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
                    scopeType: 'user',
                    scopeId: mockUserId,
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
            expect(localDB.getAll).toHaveBeenCalledWith('modules', {
                scopeType: 'user',
                scopeId: mockUserId
            });
        });
    });

    describe('get', () => {
        it('should return decrypted module detail', async () => {
            const mockRecord: ModuleRecord = {
                id: 'mod-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await ModuleService.get('mod-1');

            expect(result?.id).toBe('mod-1');
            expect(result?.name).toBe('Test Module');
        });

        it('should return null if missing or deleted', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await ModuleService.get('missing')).toBeNull();

            vi.mocked(buffer.get).mockResolvedValue({ isDeleted: true } as ModuleRecord);
            expect(await ModuleService.get('deleted')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new module', async () => {
            const result = await ModuleService.create({ name: 'New Module' });

            expect(result.id).toBe('test-module-id');
            expect(result.name).toBe('New Module');
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'modules',
                expect.objectContaining({
                    id: 'test-module-id',
                    scopeType: 'user',
                    scopeId: mockUserId
                })
            );
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
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await ModuleService.update('mod-1', { description: 'Updated' });

            expect(result.description).toBe('Updated');
            expect(result.name).toBe('Test Module'); // Preserved
            expect(buffer.update).toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should delete module and its contents in a transaction', async () => {
            const mockRecord: ModuleRecord = {
                id: 'mod-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            vi.mocked(localDB.getByIndex).mockResolvedValue([
                { id: 'child-1', isDeleted: false }
            ] as unknown as DataRecord[]);
            vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
                return callback();
            });

            await ModuleService.delete('mod-1');

            expect(localDB.transaction).toHaveBeenCalledWith(
                expect.arrayContaining(['modules', 'lorebooks', 'scripts', 'charjs']),
                'rw',
                expect.any(Function)
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'lorebooks',
                'ownerId',
                'mod-1',
                undefined
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'scripts',
                'ownerId',
                'mod-1',
                undefined
            );
            expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
                'charjs',
                'ownerId',
                'mod-1',
                undefined
            );
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('modules', 'mod-1');
        });
    });
});
