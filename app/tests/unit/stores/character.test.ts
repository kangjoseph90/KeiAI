import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    loadCharacters,
    selectCharacter,
    clearActiveCharacter,
    updateCharacter,
    updateCharacterContent,
    createCharacter,
    deleteCharacter,
    saveCharacterGreeting,
    deleteCharacterGreeting,
    createCharacterLorebook,
    deleteCharacterLorebook,
    createCharacterScript,
    deleteCharacterScript,
    createCharacterCharJS,
    deleteCharacterCharJS,
    createCharacterFolder,
    updateCharacterFolder,
    deleteCharacterFolder,
    moveCharacterItem
} from '$lib/stores/content/character';
import {
    characters,
    activeCharacter,
    activeCharacterId,
    characterLorebooks,
    characterScripts,
    characterCharJS,
    modules,
    appSettings
} from '$lib/stores/state';
import { CharacterService, LorebookService, ScriptService, CharJSService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { generateSortOrder } from '$lib/utils/ordering';
import type { Character, Lorebook, Script, CharJS } from '$lib/services';
import { makeSettings } from '../../utils';
import { deepMerge } from '$lib/utils/defaults';
import type { FolderDef } from '$lib/types/refs';

// Mock Services
vi.mock('$lib/services', () => ({
    CharacterService: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateContent: vi.fn(),
        delete: vi.fn()
    },
    AuthService: {
        isPbConnected: vi.fn(() => false),
        onPbAuthChange: vi.fn()
    },
    LorebookService: {
        create: vi.fn(),
        delete: vi.fn(),
        listByOwner: vi.fn()
    },
    ScriptService: {
        create: vi.fn(),
        delete: vi.fn(),
        listByOwner: vi.fn()
    },
    CharJSService: {
        create: vi.fn(),
        delete: vi.fn(),
        listByOwner: vi.fn()
    }
}));

// Mock Shared
vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: vi.fn(() => 'sort-order'),
    sortByRefs: vi.fn((list) => list)
}));

// Mock settings store
vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: vi.fn(),
    updateSettings: vi.fn()
}));

import { getAppSettings, updateSettings } from '$lib/stores/content/settings';

describe('Character Store', () => {
    const mockCharacter: Character = {
        id: 'char-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Test Character',
        description: 'Description',
        characterNote: '',
        backgroundHTML: '',
        messageCSS: '',
        greetings: {},
        defaultVariables: {},
        allowLowLevel: false,
        modules: { refs: {}, folders: {} },
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: { refs: {}, folders: {} }
    };

    function putActiveCharacter(character: Character): void {
        characters.set(character.id, character);
        activeCharacterId.set(character.id);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        characters.clear();
        activeCharacterId.set(null);
        characterLorebooks.clear();
        characterScripts.clear();
        characterCharJS.clear();
        modules.clear();
        appSettings.set(makeSettings({ theme: 'dark' }));
        vi.mocked(getAppSettings).mockResolvedValue(makeSettings({ theme: 'dark' }));
    });

    describe('loadCharacters', () => {
        it('should load characters and update store', async () => {
            const mockList = [mockCharacter];
            vi.mocked(CharacterService.list).mockResolvedValue(mockList);
            vi.mocked(getAppSettings).mockResolvedValue(makeSettings());

            await loadCharacters();

            expect(get(characters)).toEqual(mockList);
            expect(CharacterService.list).toHaveBeenCalled();
        });

        it('should sort characters if refs exist in settings', async () => {
            const mockList = [mockCharacter];
            const settingsWithRefs = makeSettings({
                characters: { refs: { 'char-1': { id: 'char-1', sortOrder: 'a' } } }
            });
            appSettings.set(settingsWithRefs);
            vi.mocked(getAppSettings).mockResolvedValue(settingsWithRefs);
            vi.mocked(CharacterService.list).mockResolvedValue(mockList);

            await loadCharacters();

            expect(get(characters)).toEqual(mockList);
        });
    });

    describe('selectCharacter', () => {
        it('should set active character and load related data', async () => {
            vi.mocked(CharacterService.get).mockResolvedValue(mockCharacter);
            vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
            vi.mocked(ScriptService.listByOwner).mockResolvedValue([]);
            vi.mocked(CharJSService.listByOwner).mockResolvedValue([]);

            await selectCharacter('char-1');

            expect(get(activeCharacter)).toEqual(mockCharacter);
            expect(get(characterLorebooks)).toEqual([]);
            expect(get(characterScripts)).toEqual([]);
            expect(get(characterCharJS)).toEqual([]);
        });

        it('should throw error if character not found', async () => {
            vi.mocked(CharacterService.get).mockResolvedValue(null);

            await expect(selectCharacter('invalid')).rejects.toThrow(AppError);
        });
    });

    describe('clearActiveCharacter', () => {
        it('should clear all character-related stores', () => {
            putActiveCharacter(mockCharacter);
            characterLorebooks.setAll([{ id: 'lorebook-1' } as Lorebook]);

            clearActiveCharacter();

            expect(get(activeCharacter)).toBeNull();
            expect(get(characterLorebooks)).toEqual([]);
        });
    });

    describe('updateCharacter', () => {
        it('should update character in characters list', async () => {
            characters.setAll([mockCharacter]);
            const updated = { ...mockCharacter, name: 'Updated Name' };
            vi.mocked(CharacterService.update).mockResolvedValue(updated);

            await updateCharacter('char-1', { name: 'Updated Name' });

            expect(get(characters)[0].name).toBe('Updated Name');
        });

        it('should update active character if id matches', async () => {
            putActiveCharacter(mockCharacter);
            const updated = { ...mockCharacter, name: 'Updated Name' };
            vi.mocked(CharacterService.update).mockResolvedValue(updated);

            await updateCharacter('char-1', { name: 'Updated Name' });

            expect(get(activeCharacter)?.name).toBe('Updated Name');
        });
    });

    describe('createCharacter', () => {
        it('should create character and update stores', async () => {
            vi.mocked(CharacterService.create).mockResolvedValue(mockCharacter);

            const result = await createCharacter({ name: 'Test Character' });

            expect(result).toEqual(mockCharacter);
            expect(get(characters)).toContainEqual(mockCharacter);
            expect(updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    characters: expect.objectContaining({
                        refs: expect.objectContaining({
                            'char-1': expect.objectContaining({ id: 'char-1' })
                        })
                    })
                })
            );
        });

        it('should roll back if settings update fails', async () => {
            vi.mocked(CharacterService.create).mockResolvedValue(mockCharacter);
            vi.mocked(updateSettings).mockRejectedValueOnce(new Error('Fail'));

            await expect(createCharacter({ name: 'New' })).rejects.toThrow();
            expect(CharacterService.delete).toHaveBeenCalledWith('char-1');
        });
    });

    describe('deleteCharacter', () => {
        it('should delete character and remove from stores', async () => {
            characters.setAll([mockCharacter]);
            const settings = makeSettings({
                theme: 'dark',
                characters: { refs: { 'char-1': { id: 'char-1', sortOrder: 'a' } } }
            });
            appSettings.set(settings);
            vi.mocked(getAppSettings).mockResolvedValue(settings);

            vi.mocked(updateSettings).mockImplementation(async (changes) => {
                appSettings.update((s) => (s ? deepMerge(s, changes) : s));
            });
            vi.mocked(CharacterService.delete).mockResolvedValue(undefined);

            await deleteCharacter('char-1');

            expect(get(characters)).toHaveLength(0);
            expect(get(appSettings)?.characters.refs['char-1']).toBeUndefined();
        });
    });

    describe('Greeting Management', () => {
        it('upserts a greeting through the generic character update', async () => {
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                greetings: {
                    'greeting-1': {
                        id: 'greeting-1',
                        content: 'Hello',
                        sortOrder: 'a'
                    }
                }
            });

            await saveCharacterGreeting('char-1', 'greeting-1', {
                content: 'Hello',
                sortOrder: 'a'
            });

            expect(CharacterService.update).toHaveBeenCalledWith('char-1', {
                greetings: {
                    'greeting-1': {
                        content: 'Hello',
                        sortOrder: 'a',
                        id: 'greeting-1'
                    }
                }
            });
        });

        it('deletes a greeting through the generic character update', async () => {
            vi.mocked(CharacterService.update).mockResolvedValue(mockCharacter);

            await deleteCharacterGreeting('char-1', 'greeting-1');

            expect(CharacterService.update).toHaveBeenCalledWith('char-1', {
                greetings: { 'greeting-1': undefined }
            });
        });
    });

    describe('createCharacterCharJS', () => {
        it('should create CharJS script and update store', async () => {
            putActiveCharacter(mockCharacter);
            const cjs = { id: 'cjs-1', name: 'New Script' } as CharJS;
            vi.mocked(CharJSService.create).mockResolvedValue(cjs);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                charjs: { refs: { 'cjs-1': { id: 'cjs-1', sortOrder: 'sort-order' } }, folders: {} }
            });

            await createCharacterCharJS('char-1', { name: 'New Script' });

            expect(get(characterCharJS)).toContainEqual(cjs);
            expect(CharacterService.update).toHaveBeenCalledWith(
                'char-1',
                expect.objectContaining({
                    charjs: expect.objectContaining({
                        refs: expect.objectContaining({
                            'cjs-1': expect.objectContaining({
                                id: 'cjs-1',
                                sortOrder: 'sort-order'
                            })
                        })
                    })
                })
            );
        });
    });

    describe('deleteCharacterCharJS', () => {
        it('should delete CharJS script and remove from refs', async () => {
            const charWithRefs = {
                ...mockCharacter,
                charjs: { refs: { 'cjs-1': { id: 'cjs-1', sortOrder: 'a' } }, folders: {} }
            };
            putActiveCharacter(charWithRefs);
            characterCharJS.setAll([{ id: 'cjs-1' } as CharJS]);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                charjs: { refs: {}, folders: {} }
            });
            vi.mocked(CharJSService.delete).mockResolvedValue(undefined);

            await deleteCharacterCharJS('char-1', 'cjs-1');

            expect(Object.keys(get(activeCharacter)?.charjs.refs ?? {})).toHaveLength(0);
            expect(get(characterCharJS)).toHaveLength(0);
            expect(CharJSService.delete).toHaveBeenCalledWith('cjs-1');
        });
    });

    describe('Folder Management', () => {
        it('should create a character folder', async () => {
            putActiveCharacter(mockCharacter);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                lorebooks: {
                    refs: {},
                    folders: {
                        'new-id': { id: 'new-id', name: 'My Folder', sortOrder: 'sort-order' }
                    }
                }
            });

            const folder = await createCharacterFolder('char-1', 'lorebooks', 'My Folder');

            expect(folder.name).toBe('My Folder');
            expect(get(activeCharacter)?.lorebooks.folders['new-id']).toEqual(folder);
        });

        it('should update a character folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Old', sortOrder: 'a' };
            const charWithFolder = {
                ...mockCharacter,
                lorebooks: { refs: {}, folders: { f1: folder } }
            };
            putActiveCharacter(charWithFolder);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                lorebooks: { refs: {}, folders: { f1: { ...folder, name: 'New' } } }
            });

            await updateCharacterFolder('char-1', 'lorebooks', 'f1', { name: 'New' });

            expect(get(activeCharacter)?.lorebooks.folders['f1']?.name).toBe('New');
        });

        it('should delete a character folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Folder', sortOrder: 'a' };
            const charWithFolder = {
                ...mockCharacter,
                lorebooks: { refs: {}, folders: { f1: folder } }
            };
            putActiveCharacter(charWithFolder);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                lorebooks: { refs: {}, folders: {} }
            });

            await deleteCharacterFolder('char-1', 'lorebooks', 'f1');

            expect(Object.keys(get(activeCharacter)?.lorebooks.folders ?? {})).toHaveLength(0);
        });
    });

    describe('moveCharacterItem', () => {
        it('should move item to a different folder', async () => {
            const charWithRefs = {
                ...mockCharacter,
                lorebooks: {
                    refs: { 'lorebook-1': { id: 'lorebook-1', sortOrder: 'a' } },
                    folders: {}
                }
            };
            putActiveCharacter(charWithRefs);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                lorebooks: {
                    refs: {
                        'lorebook-1': {
                            id: 'lorebook-1',
                            sortOrder: 'a',
                            folderId: 'folder-1'
                        }
                    },
                    folders: {}
                }
            });

            await moveCharacterItem('char-1', 'lorebooks', 'lorebook-1', 'folder-1');

            expect(get(activeCharacter)?.lorebooks.refs['lorebook-1']?.folderId).toBe('folder-1');
        });
    });
});
