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

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(() => ({
        userId: 'user-123',
        masterKey: {} as CryptoKey,
        identityKeyPair: {} as CryptoKeyPair
    })),
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    })
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
import { buffer } from '$lib/services/content/record_buffer';
import { makeSettings } from '../../utils';

describe('SettingsService', () => {
    const mockUserId = 'user-123';
    const mockNow = 1710000000000;

    const mockSettings: AppSettings = makeSettings({ openai: { apiKey: 'sk-test' } });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);

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
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };

            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await SettingsService.get();

            expect(result.openai?.apiKey).toBe('sk-test');
            expect(buffer.get).toHaveBeenCalledWith('settings', mockUserId);
        });

        it('should return default settings if record missing', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);

            const result = await SettingsService.get();

            expect(result).toEqual(defaultSettings);
        });

        it('should return defaults when record is empty', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: mockUserId,
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: {}
            } as SettingsRecord);

            const result = await SettingsService.get();

            expect(result.translation.workflow).toEqual({ nodes: {} });
            expect(result.chat.autoGenerateResponse).toBe(true);
        });

        it('should add the default auto-generation setting to older records', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                id: mockUserId,
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 100,
                isDeleted: false,
                data: {
                    chat: {
                        saveMessagesOnSwipe: false,
                        expandStepsOnGeneration: false
                    }
                }
            } as SettingsRecord);

            const result = await SettingsService.get();

            expect(result.chat).toEqual({
                saveMessagesOnSwipe: false,
                expandStepsOnGeneration: false,
                autoGenerateResponse: true
            });
        });
    });

    describe('update', () => {
        it('should perform read-modify-write merge update', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 110,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await SettingsService.update({ openai: { apiKey: 'sk-updated' } });

            expect(result.openai?.apiKey).toBe('sk-updated');
            expect(result.chat).toEqual(mockSettings.chat);
            expect(buffer.update).toHaveBeenCalled();
        });

        it('should disable automatic generation without changing other chat settings', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 110,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await SettingsService.update({
                chat: { autoGenerateResponse: false }
            });

            expect(result.chat.autoGenerateResponse).toBe(false);
            expect(result.chat.saveMessagesOnSwipe).toBe(mockSettings.chat.saveMessagesOnSwipe);
            expect(result.chat.expandStepsOnGeneration).toBe(
                mockSettings.chat.expandStepsOnGeneration
            );
        });

        it('should preserve createdAt across consecutive queued updates', async () => {
            const mockRecord: SettingsRecord = {
                id: mockUserId,
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 100,
                updatedAt: 110,
                isDeleted: false,
                data: mockSettings as unknown as Record<string, unknown>
            };
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            await SettingsService.update({ openai: { apiKey: 'sk-updated' } });
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

            const result = await SettingsService.update({
                chat: { autoGenerateResponse: false }
            });

            expect(result.chat.autoGenerateResponse).toBe(false);
            expect(buffer.update).toHaveBeenCalled();
        });
    });
});
