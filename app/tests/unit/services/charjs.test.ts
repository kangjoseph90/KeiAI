/**
 * CharJS Service Tests
 *
 * Tests the CharJSService handling script CRUD operations
 * with local DB writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CharJSService } from '$lib/services/content/charjs';
import type { BaseRecord } from '$lib/adapters/db/types';
import { AppError } from '$lib/types/errors';

// Mock dependencies
vi.mock('$lib/services/user', () => ({
    UserService: {},
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getByIndex: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn(),
        subscribeWriteEvents: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-id')
}));

vi.mock('$lib/services/content/write_queue', () => ({
    writeQueue: {
        peek: vi.fn(() => undefined),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { getActiveSession } from '$lib/services/user';
import { localDB } from '$lib/adapters/db';
import { writeQueue } from '$lib/services/content/write_queue';

describe('CharJSService', () => {
    const mockUserId = 'user-123';

    const defaultCharJSParams = {
        name: 'Test Script',
        code: 'return true;',
        enabled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
    });

    describe('listByOwner', () => {
        it('should return charjs scripts for an owner', async () => {
            const mockRecords = [
                {
                    id: 'c-1',
                    ownerId: 'owner-1',
                    data: defaultCharJSParams
                } as unknown as BaseRecord
            ];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

            const result = await CharJSService.listByOwner('owner-1');

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('c-1');
            expect(result[0].name).toBe('Test Script');
            expect(result[0].code).toBe('return true;');
        });
    });

    describe('get', () => {
        it('should return charjs detail', async () => {
            const mockRecord = {
                id: 'c-1',
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultCharJSParams
            } as unknown as BaseRecord;

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await CharJSService.get('c-1');

            expect(result).toBeDefined();
            expect(result?.id).toBe('c-1');
            expect(result?.name).toBe('Test Script');
        });

        it('should return null if record is missing or deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);
            expect(await CharJSService.get('non-existent')).toBeNull();

            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'deleted',
                isDeleted: true
            } as unknown as BaseRecord);
            expect(await CharJSService.get('deleted')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new charjs script with merged defaults', async () => {
            const result = await CharJSService.create('owner-1', { name: 'Custom Name' });

            expect(result.id).toBe('test-id');
            expect(result.ownerId).toBe('owner-1');
            expect(result.name).toBe('Custom Name');
            expect(result.code).toBe(''); // Default from service

            expect(localDB.putRecord).toHaveBeenCalledWith(
                'charjs',
                expect.objectContaining({
                    id: 'test-id',
                    ownerId: 'owner-1',
                    data: expect.objectContaining({
                        name: 'Custom Name',
                        code: ''
                    })
                })
            );
        });
    });

    describe('update', () => {
        it('should update and merge existing fields via write queue', async () => {
            const mockRecord = {
                id: 'c-1',
                userId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultCharJSParams
            } as unknown as BaseRecord;

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await CharJSService.update('c-1', { code: 'new code' });

            expect(result.code).toBe('new code');
            expect(result.name).toBe('Test Script'); // Preserved from existing

            expect(writeQueue.update).toHaveBeenCalled();
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('should throw if not found', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            await expect(CharJSService.update('missing', { name: 'new' })).rejects.toThrow(
                'CharJS script not found: missing'
            );
        });
    });

    describe('delete', () => {
        it('should soft delete the charjs script', async () => {
            await CharJSService.delete('c-1');

            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('charjs', 'c-1');
        });
    });

    describe('onChange', () => {
        it('should subscribe to localDB write events for charjs table', () => {
            const callback = vi.fn();
            CharJSService.onChange(callback);

            expect(localDB.subscribeWriteEvents).toHaveBeenCalled();
            // test if the callback correctly fires
            const registeredFn = vi.mocked(localDB.subscribeWriteEvents).mock.calls[0][0];

            registeredFn([
                { tableName: 'charjs', operation: 'put', ids: ['c-1'], origin: 'local' }
            ]);
            expect(callback).toHaveBeenCalledWith('c-1');

            registeredFn([
                { tableName: 'scripts', operation: 'put', ids: ['s-1'], origin: 'local' }
            ]);
            expect(callback).toHaveBeenCalledTimes(1); // not called again
        });
    });
});
