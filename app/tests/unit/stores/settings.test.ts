import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    loadSettings,
    updateSettings,
    createGlobalFolder,
    updateGlobalFolder,
    deleteGlobalFolder,
    moveGlobalItem
} from '$lib/stores/content/settings';
import { appSettings } from '$lib/stores/state';
import { SettingsService } from '$lib/services';
import type { AppSettings } from '$lib/services';
import { makeSettings } from '../../utils';

// Mock Services
vi.mock('$lib/services', () => ({
    SettingsService: {
        get: vi.fn(),
        update: vi.fn()
    }
}));

// Mock Shared
vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: vi.fn(() => 'sort-order')
}));

describe('Settings Store', () => {
    const mockSettings: AppSettings = makeSettings({
        theme: 'dark',
        characterRefs: [],
        personaRefs: [],
        presetRefs: [],
        moduleRefs: [],
        pluginRefs: []
    });

    beforeEach(() => {
        vi.clearAllMocks();
        appSettings.set(mockSettings);
    });

    describe('loadSettings', () => {
        it('should load settings from service', async () => {
            vi.mocked(SettingsService.get).mockResolvedValue(mockSettings);

            await loadSettings();

            expect(get(appSettings)).toEqual(mockSettings);
            expect(SettingsService.get).toHaveBeenCalled();
        });
    });

    describe('updateSettings', () => {
        it('should update settings and store', async () => {
            const updated = { ...mockSettings, theme: 'light' };
            vi.mocked(SettingsService.update).mockResolvedValue(updated as unknown as AppSettings);

            await updateSettings({ theme: 'light' });

            expect(get(appSettings)!.theme).toBe('light');
            expect(SettingsService.update).toHaveBeenCalledWith({ theme: 'light' });
        });
    });

    describe('Folder Management', () => {
        it('should create global folder', async () => {
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    folders: {
                        characters: [{ id: 'new-id', name: 'Folder', sortOrder: 'sort-order' }]
                    }
                })
            );

            const folder = await createGlobalFolder('characters', 'Folder');

            expect(folder.name).toBe('Folder');
            expect(get(appSettings)!.folders?.characters).toHaveLength(1);
        });

        it('should update global folder', async () => {
            const settingsWithFolder = {
                ...mockSettings,
                folders: { characters: [{ id: 'f1', name: 'Old', sortOrder: 'a' }] }
            };
            appSettings.set(makeSettings(settingsWithFolder));
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    folders: { characters: [{ id: 'f1', name: 'New', sortOrder: 'a' }] }
                })
            );

            await updateGlobalFolder('characters', 'f1', { name: 'New' });

            expect(get(appSettings)!.folders?.characters?.[0].name).toBe('New');
        });

        it('should delete global folder', async () => {
            const settingsWithFolder = {
                ...mockSettings,
                folders: { characters: [{ id: 'f1', name: 'Folder', sortOrder: 'a' }] }
            };
            appSettings.set(makeSettings(settingsWithFolder));
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    folders: { characters: [] }
                })
            );

            await deleteGlobalFolder('characters', 'f1');

            expect(get(appSettings)!.folders?.characters).toHaveLength(0);
        });
    });

    describe('moveGlobalItem', () => {
        it('should move character to a folder', async () => {
            const settingsWithRef = {
                ...mockSettings,
                characterRefs: [{ id: 'char-1', sortOrder: 'a' }]
            };
            appSettings.set(makeSettings(settingsWithRef));
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    characterRefs: [{ id: 'char-1', sortOrder: 'a', folderId: 'f1' }]
                })
            );

            await moveGlobalItem('characters', 'char-1', 'f1');

            expect(get(appSettings)!.characterRefs?.[0].folderId).toBe('f1');
        });
    });
});
