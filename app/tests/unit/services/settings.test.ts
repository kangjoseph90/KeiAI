/**
 * Settings Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsService, type AppSettings, defaultSettings } from '$lib/services/content/settings';
import type { SettingsRecord } from '$lib/adapters/db';

// Mock dependencies
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
        getRecord: vi.fn(),
        putRecord: vi.fn()
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

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession, UserService } from '$lib/services/user';
import { buffer } from '$lib/services/content/record_buffer';
import { makeSettings } from '../../utils';

describe('SettingsService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;
    const mockNow = 1710000000000;

    const mockSettings: AppSettings = makeSettings({
        theme: 'dark',
        openai: { apiKey: 'sk-test' }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([13, 14, 15]),
            iv: new Uint8Array([16, 17, 18])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(mockSettings));
    });

    describe('get', () => {
        it('should return decrypted settings for the user', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await SettingsService.get();

            expect(result.theme).toBe('dark');
            expect(result.openai?.apiKey).toBe('sk-test');
            expect(buffer.get).toHaveBeenCalledWith('settings', mockUserId);
        });

        it('should return default settings if record missing', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            const result = await SettingsService.get();

            expect(result.theme).toBe('system');
        });

        it('should return defaults when record is empty', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: mockUserId,
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: {}
            } as SettingsRecord);

            const result = await SettingsService.get();

            expect(result.theme).toBe('system');
        });
    });

    describe('update', () => {
        it('should perform read-modify-write merge update', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 110,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await SettingsService.update({ theme: 'light' });

            expect(result.theme).toBe('light');
            expect(result.openai?.apiKey).toBe('sk-test'); // Preserved
            expect(buffer.update).toHaveBeenCalled();
        });

        it('should preserve createdAt across consecutive queued updates', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                userId: mockUserId,
                createdAt: 100,
                updatedAt: 110,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            await SettingsService.update({ theme: 'light' });
            await SettingsService.update({ chat: { saveMessagesOnSwipe: false } });

            expect(buffer.update).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    tableName: 'settings',
                    record: expect.objectContaining({
                        id: mockUserId,
                        createdAt: 100
                    })
                })
            );
        });

        it('should handle updates when no record exists', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            const result = await SettingsService.update({ theme: 'dark' });

            expect(result.theme).toBe('dark');
            expect(buffer.update).toHaveBeenCalled();
        });
    });
});
