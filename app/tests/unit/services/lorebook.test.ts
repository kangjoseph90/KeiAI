/**
 * Lorebook Service Tests
 *
 * Tests the LorebookService handling lorebook CRUD operations
 * with local DB writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LorebookService } from '$lib/services/content/lorebook';
import type { BaseRecord } from '$lib/adapters/db/types';
import { AppError } from '$lib/types/errors';

// Mock dependencies
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
    })
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

import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('LorebookService', () => {
    const mockUserId = 'user-123';

    const defaultLorebookParams = {
        name: 'Test Lore',
        key: 'key1, key2',
        secondKey: '',
        content: 'Content',
        depth: 2,
        disabled: false,
        useMultipleKeys: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    describe('listByOwner', () => {
        it('should return lorebooks for an owner', async () => {
            const mockRecords = [
                {
                    id: 'lb-1',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    ownerId: 'owner-1',
                    data: defaultLorebookParams
                } as unknown as BaseRecord
            ];

            vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

            const result = await LorebookService.listByOwner('owner-1');

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('lb-1');
            expect(result[0].name).toBe('Test Lore');
            expect(result[0].key).toBe('key1, key2');
        });
    });

    describe('get', () => {
        it('should return lorebook detail', async () => {
            const mockRecord = {
                id: 'lb-1',
                scopeType: 'user',
                scopeId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultLorebookParams
            } as unknown as BaseRecord;

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await LorebookService.get('lb-1');

            expect(result).toBeDefined();
            expect(result?.id).toBe('lb-1');
            expect(result?.name).toBe('Test Lore');
        });

        it('should return null if record is missing or deleted', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await LorebookService.get('non-existent')).toBeNull();

            vi.mocked(buffer.get).mockResolvedValue({
                id: 'deleted',
                isDeleted: true
            } as never);
            expect(await LorebookService.get('deleted')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a new lorebook with merged defaults', async () => {
            const result = await LorebookService.create('owner-1', { name: 'Custom Name' });

            expect(result.id).toBe('test-id');
            expect(result.ownerId).toBe('owner-1');
            expect(result.name).toBe('Custom Name');
            expect(result.depth).toBe(0); // From defaults

            expect(localDB.putRecord).toHaveBeenCalledWith(
                'lorebooks',
                expect.objectContaining({
                    id: 'test-id',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    ownerId: 'owner-1',
                    data: expect.objectContaining({
                        name: 'Custom Name',
                        depth: 0
                    })
                })
            );
        });
    });

    describe('update', () => {
        it('should update and merge existing fields via write queue', async () => {
            const mockRecord = {
                id: 'lb-1',
                scopeType: 'user',
                scopeId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultLorebookParams
            } as unknown as BaseRecord;

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await LorebookService.update('lb-1', { name: 'Updated name' });

            expect(result.name).toBe('Updated name');
            expect(result.content).toBe('Content'); // Preserved from existing

            expect(buffer.update).toHaveBeenCalled();
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('should throw if not found', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            await expect(LorebookService.update('missing', { name: 'new' })).rejects.toThrow(
                'Lorebook not found: missing'
            );
        });
    });

    describe('delete', () => {
        it('should soft delete the lorebook', async () => {
            const mockRecord = {
                id: 'lb-1',
                scopeType: 'user',
                scopeId: mockUserId,
                ownerId: 'owner-1',
                isDeleted: false,
                data: defaultLorebookParams
            } as unknown as BaseRecord;
            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            await LorebookService.delete('lb-1');

            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('lorebooks', 'lb-1');
        });
    });
});
