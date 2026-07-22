import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    loadSettings,
    updateSettings,
    saveCustomLLMModel,
    deleteCustomLLMModel,
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
        theme: 'dark'
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

    describe('Custom LLM Models', () => {
        it('upserts a model with canonical identity metadata', async () => {
            vi.mocked(SettingsService.update).mockResolvedValue(mockSettings);

            await saveCustomLLMModel('custom::model-1', {
                name: 'Model',
                sortOrder: 'a'
            });

            expect(SettingsService.update).toHaveBeenCalledWith({
                custom: {
                    llm: {
                        models: {
                            'custom::model-1': {
                                name: 'Model',
                                sortOrder: 'a',
                                id: 'custom::model-1',
                                provider: 'custom'
                            }
                        }
                    }
                }
            });
        });

        it('deletes a model through the generic settings update', async () => {
            vi.mocked(SettingsService.update).mockResolvedValue(mockSettings);

            await deleteCustomLLMModel('custom::model-1');

            expect(SettingsService.update).toHaveBeenCalledWith({
                custom: { llm: { models: { 'custom::model-1': undefined } } }
            });
        });
    });

    describe('Folder Management', () => {
        it('should create global folder', async () => {
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    characters: {
                        folders: {
                            'new-id': { id: 'new-id', name: 'Folder', sortOrder: 'sort-order' }
                        }
                    }
                })
            );

            const folder = await createGlobalFolder('characters', 'Folder');

            expect(folder.name).toBe('Folder');
            expect(get(appSettings)!.characters?.folders?.['new-id']).toEqual(folder);
        });

        it('should update global folder', async () => {
            const settingsWithFolder = makeSettings({
                ...mockSettings,
                characters: {
                    folders: { f1: { id: 'f1', name: 'Old', sortOrder: 'a' } }
                }
            });
            appSettings.set(settingsWithFolder);
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    characters: {
                        folders: { f1: { id: 'f1', name: 'New', sortOrder: 'a' } }
                    }
                })
            );

            await updateGlobalFolder('characters', 'f1', { name: 'New' });

            expect(get(appSettings)!.characters?.folders?.['f1']?.name).toBe('New');
        });

        it('should delete global folder', async () => {
            const settingsWithFolder = makeSettings({
                ...mockSettings,
                characters: {
                    folders: { f1: { id: 'f1', name: 'Folder', sortOrder: 'a' } }
                }
            });
            appSettings.set(settingsWithFolder);
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    characters: { folders: {} }
                })
            );

            await deleteGlobalFolder('characters', 'f1');

            expect(Object.keys(get(appSettings)!.characters?.folders ?? {})).toHaveLength(0);
        });
    });

    describe('moveGlobalItem', () => {
        it('should move character to a folder', async () => {
            const settingsWithRef = makeSettings({
                ...mockSettings,
                characters: {
                    refs: { 'char-1': { id: 'char-1', sortOrder: 'a' } }
                }
            });
            appSettings.set(settingsWithRef);
            vi.mocked(SettingsService.update).mockResolvedValue(
                makeSettings({
                    ...mockSettings,
                    characters: {
                        refs: { 'char-1': { id: 'char-1', sortOrder: 'a', folderId: 'f1' } }
                    }
                })
            );

            await moveGlobalItem('characters', 'char-1', 'f1');

            expect(get(appSettings)!.characters.refs['char-1']?.folderId).toBe('f1');
        });
    });
});
