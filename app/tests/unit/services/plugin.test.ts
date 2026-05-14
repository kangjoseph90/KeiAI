/**
 * Plugin Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginService, type PluginFields } from '$lib/services/content/plugin';
import type { PluginRecord } from '$lib/adapters/db';
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
        softDeleteRecord: vi.fn()
    }
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-plugin-id')
}));

import { encrypt, decrypt } from '$lib/crypto';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('PluginService', () => {
    const mockUserId = 'user-123';
    const defaultFields: PluginFields = {
        name: 'Test Plugin',
        description: 'Desc',
        version: '1.0.0',
        enabled: true,
        code: 'console.log("hello")',
        args: { key: 'val' }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([7, 8, 9]),
            iv: new Uint8Array([10, 11, 12])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(defaultFields));
    });

    describe('list', () => {
        it('should return decrypted plugins', async () => {
            const mockRecords: PluginRecord[] = [
                {
                    id: 'p-1',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    createdAt: 100,
                    updatedAt: 100,
                    isDeleted: false,
                    data: defaultFields as unknown as Record<string, unknown>
                }
            ];

            vi.mocked(localDB.getAll).mockResolvedValue(mockRecords);

            const result = await PluginService.list();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('p-1');
            expect(result[0].name).toBe('Test Plugin');
            expect(result[0].args).toBeDefined();
        });
    });

    describe('get', () => {
        it('should return decrypted plugin', async () => {
            const mockRecord: PluginRecord = {
                id: 'p-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await PluginService.get('p-1');
            expect(result?.id).toBe('p-1');
            expect(result?.code).toBe('console.log("hello")');
        });
    });

    describe('create', () => {
        it('should create a new plugin', async () => {
            const result = await PluginService.create({ name: 'New Plugin' });

            expect(result.id).toBe('test-plugin-id');
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'plugins',
                expect.objectContaining({
                    id: 'test-plugin-id',
                    scopeType: 'user',
                    scopeId: mockUserId
                })
            );
        });
    });

    describe('update', () => {
        it('should update and merge plugin fields', async () => {
            const mockRecord: PluginRecord = {
                id: 'p-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await PluginService.update('p-1', { version: '1.1.0' });

            expect(result.version).toBe('1.1.0');
            expect(result.name).toBe('Test Plugin');
            expect(buffer.update).toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should soft delete a plugin', async () => {
            const mockRecord: PluginRecord = {
                id: 'p-1',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: defaultFields as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            await PluginService.delete('p-1');

            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('plugins', 'p-1');
        });
    });
});
