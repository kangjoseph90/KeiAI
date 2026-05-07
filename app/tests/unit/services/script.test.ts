/**
 * Script Service Tests
 *
 * Tests the ScriptService handling script CRUD operations
 * with local DB writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScriptService } from '$lib/services/content/script';
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
        softDeleteRecord: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-id')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { getActiveSession, UserService } from '$lib/services/user';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('ScriptService', () => {
    const mockUserId = 'user-123';

    const defaultScriptParams = {
        name: 'Test Script',
        regex: '.*',
        replacement: 'test',
        phase: 'display',
        enabled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
    });

    describe('listByOwner', () => {
        it('should return scripts for an owner', async () => {
            const mockRecords = [
                {
                    id: 's-1',
                    userId: mockUserId,
                    ownerId: 'owner-1',
                    data: defaultScriptParams
                } as unknown as BaseRecord
            ];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

            const result = await ScriptService.listByOwner('owner-1');

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('s-1');
            expect(result[0].name).toBe('Test Script');
            expect(result[0].replacement).toBe('test');
        });
    });

    describe('get', () => {
        it('should return script detail', async () => {
            const mockRecord = {
                id: 's-1',
                userId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultScriptParams
            } as unknown as BaseRecord;

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await ScriptService.get('s-1');

            expect(result).toBeDefined();
            expect(result?.id).toBe('s-1');
            expect(result?.name).toBe('Test Script');
        });

        it('should return null if record is missing or deleted', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await ScriptService.get('non-existent')).toBeNull();

            vi.mocked(buffer.get).mockResolvedValue({
                id: 'deleted',
                isDeleted: true
            } as never);
            expect(await ScriptService.get('deleted')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new script with merged defaults', async () => {
            const result = await ScriptService.create('owner-1', { name: 'Custom Name' });

            expect(result.id).toBe('test-id');
            expect(result.ownerId).toBe('owner-1');
            expect(result.name).toBe('Custom Name');
            expect(result.phase).toBe('display'); // From defaults

            expect(localDB.putRecord).toHaveBeenCalledWith(
                'scripts',
                expect.objectContaining({
                    id: 'test-id',
                    ownerId: 'owner-1',
                    data: expect.objectContaining({
                        name: 'Custom Name',
                        phase: 'display'
                    })
                })
            );
        });
    });

    describe('update', () => {
        it('should update and merge existing fields via write queue', async () => {
            const mockRecord = {
                id: 's-1',
                userId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultScriptParams
            } as unknown as BaseRecord;

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await ScriptService.update('s-1', { phase: 'output' });

            expect(result.phase).toBe('output');
            expect(result.name).toBe('Test Script'); // Preserved from existing

            expect(buffer.update).toHaveBeenCalled();
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('should throw if not found', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            await expect(ScriptService.update('missing', { name: 'new' })).rejects.toThrow(
                'Script not found: missing'
            );
        });
    });

    describe('delete', () => {
        it('should soft delete the script', async () => {
            const mockRecord = {
                id: 's-1',
                userId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultScriptParams
            } as unknown as BaseRecord;
            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            await ScriptService.delete('s-1');

            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('scripts', 's-1');
        });
    });
});
