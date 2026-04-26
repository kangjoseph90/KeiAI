/**
 * Settings Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsService, type AppSettings, defaultSettings } from '$lib/services/content/settings';
import type { SettingsRecord } from '$lib/adapters/db';
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
        getRecord: vi.fn(),
        putRecord: vi.fn()
    }
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { makeSettings } from '../../utils';

describe('SettingsService', () => {
    const mockUserId = 'user-123';
    const mockMasterKey = {} as CryptoKey;
    const mockNow = 1710000000000;

    const mockSettings: AppSettings = makeSettings({
        theme: 'dark',
        openai: { apiKey: 'sk-test' },
        characterRefs: []
    });

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

            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await SettingsService.get();

            expect(result.theme).toBe('dark');
            expect(result.openai?.apiKey).toBe('sk-test');
            expect(localDB.getRecord).toHaveBeenCalledWith('settings', mockUserId);
        });

        it('should return default settings if record missing', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as SettingsRecord);

            const result = await SettingsService.get();

            expect(result.theme).toBe('system');
        });

        it('should return defaults when record is empty', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue({
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

    describe('set', () => {
        it('should encrypt and save full settings object', async () => {
            await SettingsService.set(mockSettings);
            await vi.runAllTimersAsync();

            expect(localDB.putRecord).toHaveBeenCalledWith(
                'settings',
                expect.objectContaining({
                    id: mockUserId,
                    data: expect.any(Object)
                }),
                undefined
            );
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
            vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

            const result = await SettingsService.update({ theme: 'light' });
            await vi.runAllTimersAsync();

            expect(result.theme).toBe('light');
            expect(result.openai?.apiKey).toBe('sk-test'); // Preserved
            expect(localDB.putRecord).toHaveBeenCalled();
        });

        it('should handle updates when no record exists', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as SettingsRecord);

            const result = await SettingsService.update({ theme: 'dark' });
            await vi.runAllTimersAsync();

            expect(result.theme).toBe('dark');
            expect(localDB.putRecord).toHaveBeenCalled();
        });
    });
});
