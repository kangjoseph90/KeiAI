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
vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn()
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

vi.mock('$lib/services/content/write_queue', () => ({
    writeQueue: {
        peek: vi.fn(() => undefined),
        upsert: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { writeQueue } from '$lib/services/content/write_queue';

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

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            isGuest: false,
            identityKeyPair: {} as CryptoKeyPair
        });
    });

    describe('listByOwner', () => {
        it('should return scripts for an owner', async () => {
            const mockRecords = [
                {
                    id: 's-1',
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
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultScriptParams
            } as unknown as BaseRecord;

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await ScriptService.get('s-1');

            expect(result).toBeDefined();
            expect(result?.id).toBe('s-1');
            expect(result?.name).toBe('Test Script');
        });

        it('should return null if record is missing or deleted', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);
            expect(await ScriptService.get('non-existent')).toBeNull();

            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'deleted',
                isDeleted: true
            } as unknown as BaseRecord);
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

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await ScriptService.update('s-1', { phase: 'output' });

            expect(result.phase).toBe('output');
            expect(result.name).toBe('Test Script'); // Preserved from existing

            expect(writeQueue.upsert).toHaveBeenCalled();
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('should throw if not found', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

            await expect(ScriptService.update('missing', { name: 'new' })).rejects.toThrow(
                'Script not found: missing'
            );
        });
    });

    describe('delete', () => {
        it('should soft delete the script', async () => {
            await ScriptService.delete('s-1');

            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('scripts', 's-1');
        });
    });
});
