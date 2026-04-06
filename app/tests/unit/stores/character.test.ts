import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	loadCharacters,
	selectCharacter,
	clearActiveCharacter,
	updateCharacterSummary,
	updateCharacterData,
	updateCharacterFull,
	createCharacter,
	deleteCharacter,
	createCharacterLorebook,
	deleteCharacterLorebook,
	createCharacterScript,
	deleteCharacterScript,
	createCharacterFolder,
	updateCharacterFolder,
	deleteCharacterFolder,
	moveCharacterItem
} from '$lib/stores/content/character';
import {
	characters,
	activeCharacter,
	characterLorebooks,
	characterScripts,
	characterModules,
	chats,
	modules,
	appSettings,
	activeCharacterId
} from '$lib/stores/state';
import {
	CharacterService,
	ChatService,
	LorebookService,
	ScriptService,
	SettingsService
} from '$lib/services';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { generateSortOrder } from '$lib/utils/ordering';
import type {
	CharacterDetail,
	Character,
	Lorebook,
	Script,
	Chat,
	AppSettings,
	CharacterDataFields
} from '$lib/services';
import type { FolderDef, OrderedRef } from '$lib/types/refs';

// Mock Services
vi.mock('$lib/services', () => ({
	CharacterService: {
		list: vi.fn(),
		getDetail: vi.fn(),
		create: vi.fn(),
		updateSummary: vi.fn(),
		updateData: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	},
	ChatService: {
		listByCharacter: vi.fn()
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
	generateSortOrder: vi.fn(() => 'sort-order'),
	sortByRefs: vi.fn((list) => list)
}));

// Mock other stores
vi.mock('$lib/stores/content/chat', () => ({
	clearActiveChat: vi.fn()
}));

import { clearActiveChat } from '$lib/stores/content/chat';

describe('Character Store', () => {
	const mockCharacter: Character = {
		id: 'char-1',
		name: 'Test Character',
		shortDescription: 'Description'
	};

	const mockCharacterDetail: CharacterDetail = {
		...mockCharacter,
		data: {
			systemPrompt: 'Prompt',
			chatRefs: [],
			lorebookRefs: [],
			scriptRefs: [],
			moduleRefs: [],
			folders: {}
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		characters.set([]);
		activeCharacter.set(null);
		characterLorebooks.set([]);
		characterScripts.set([]);
		characterModules.set([]);
		chats.set([]);
		modules.set([]);
		appSettings.set({
			theme: 'dark',
			providers: {},
			characterRefs: [],
			chatRefs: []
		} as AppSettings);
	});

	describe('loadCharacters', () => {
		it('should load characters and update store', async () => {
			const mockList = [mockCharacter];
			vi.mocked(CharacterService.list).mockResolvedValue(mockList);

			await loadCharacters();

			expect(get(characters)).toEqual(mockList);
			expect(CharacterService.list).toHaveBeenCalled();
		});

		it('should sort characters if refs exist in settings', async () => {
			const mockList = [mockCharacter];
			appSettings.set({ characterRefs: [{ id: 'char-1', sortOrder: 'a' }] } as AppSettings);
			vi.mocked(CharacterService.list).mockResolvedValue(mockList);

			await loadCharacters();

			expect(get(characters)).toEqual(mockList);
		});
	});

	describe('selectCharacter', () => {
		it('should set active character and load related data', async () => {
			vi.mocked(CharacterService.getDetail).mockResolvedValue(mockCharacterDetail);
			vi.mocked(ChatService.listByCharacter).mockResolvedValue([]);
			vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
			vi.mocked(ScriptService.listByOwner).mockResolvedValue([]);

			await selectCharacter('char-1');

			expect(get(activeCharacter)).toEqual(mockCharacterDetail);
			expect(clearActiveChat).toHaveBeenCalled();
			expect(get(chats)).toEqual([]);
			expect(get(characterLorebooks)).toEqual([]);
			expect(get(characterScripts)).toEqual([]);
		});

		it('should throw error if character not found', async () => {
			vi.mocked(CharacterService.getDetail).mockResolvedValue(null);

			await expect(selectCharacter('invalid')).rejects.toThrow(AppError);
		});
	});

	describe('clearActiveCharacter', () => {
		it('should clear all character-related stores', () => {
			activeCharacter.set(mockCharacterDetail);
			chats.set([{ id: 'chat-1' } as Chat]);

			clearActiveCharacter();

			expect(get(activeCharacter)).toBeNull();
			expect(get(chats)).toEqual([]);
			expect(get(characterLorebooks)).toEqual([]);
			expect(clearActiveChat).toHaveBeenCalled();
		});
	});

	describe('updateCharacterSummary', () => {
		it('should update character summary in characters list', async () => {
			characters.set([mockCharacter]);
			const updated = { ...mockCharacter, name: 'Updated Name' };
			vi.mocked(CharacterService.updateSummary).mockResolvedValue(updated);

			await updateCharacterSummary('char-1', { name: 'Updated Name' });

			expect(get(characters)[0].name).toBe('Updated Name');
		});

		it('should update active character if id matches', async () => {
			activeCharacter.set(mockCharacterDetail);
			const updated = { ...mockCharacter, name: 'Updated Name' };
			vi.mocked(CharacterService.updateSummary).mockResolvedValue(updated);

			await updateCharacterSummary('char-1', { name: 'Updated Name' });

			expect(get(activeCharacter)?.name).toBe('Updated Name');
		});
	});

	describe('createCharacter', () => {
		it('should create character and update stores', async () => {
			vi.mocked(CharacterService.create).mockResolvedValue(mockCharacterDetail);
			vi.mocked(SettingsService.update).mockResolvedValue({
				theme: 'dark',
				providers: {},
				characterRefs: []
			} as AppSettings);

			const result = await createCharacter({ name: 'New' });

			expect(result).toEqual(mockCharacterDetail);
			expect(get(characters)).toContainEqual(mockCharacterDetail);
			expect(SettingsService.update).toHaveBeenCalledWith({
				characterRefs: expect.arrayContaining([expect.objectContaining({ id: 'char-1' })])
			});
		});

		it('should roll back if settings update fails', async () => {
			vi.mocked(CharacterService.create).mockResolvedValue(mockCharacterDetail);
			vi.mocked(SettingsService.update).mockRejectedValue(new Error('Fail'));

			await expect(createCharacter({ name: 'New' })).rejects.toThrow();
			expect(CharacterService.delete).toHaveBeenCalledWith('char-1');
		});
	});

	describe('deleteCharacter', () => {
		it('should delete character and remove from stores', async () => {
			characters.set([mockCharacter]);
			appSettings.set({
				theme: 'dark',
				providers: {},
				characterRefs: [{ id: 'char-1', sortOrder: 'a' }]
			} as AppSettings);
			vi.mocked(SettingsService.update).mockResolvedValue({
				theme: 'dark',
				providers: {},
				characterRefs: []
			} as AppSettings);
			vi.mocked(CharacterService.delete).mockResolvedValue(undefined);

			await deleteCharacter('char-1');

			expect(get(characters)).toHaveLength(0);
			expect(get(appSettings)?.characterRefs).toHaveLength(0);
		});
	});

	describe('Folder Management', () => {
		it('should create a character folder', async () => {
			activeCharacter.set(mockCharacterDetail);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			const folder = await createCharacterFolder('char-1', 'chats', 'My Folder');

			expect(folder.name).toBe('My Folder');
			expect(get(activeCharacter)?.data.folders?.chats).toContainEqual(folder);
		});

		it('should update a character folder', async () => {
			const folder: FolderDef = { id: 'f1', name: 'Old', sortOrder: 'a' };
			const charWithFolder = {
				...mockCharacterDetail,
				data: { ...mockCharacterDetail.data, folders: { chats: [folder] } }
			};
			activeCharacter.set(charWithFolder);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			await updateCharacterFolder('char-1', 'chats', 'f1', { name: 'New' });

			expect(get(activeCharacter)?.data.folders?.chats?.[0].name).toBe('New');
		});

		it('should delete a character folder', async () => {
			const folder: FolderDef = { id: 'f1', name: 'Folder', sortOrder: 'a' };
			const charWithFolder = {
				...mockCharacterDetail,
				data: { ...mockCharacterDetail.data, folders: { chats: [folder] } }
			};
			activeCharacter.set(charWithFolder);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			await deleteCharacterFolder('char-1', 'chats', 'f1');

			expect(get(activeCharacter)?.data.folders?.chats).toHaveLength(0);
		});
	});

	describe('moveCharacterItem', () => {
		it('should move item to a different folder', async () => {
			const charWithRefs = {
				...mockCharacterDetail,
				data: {
					...mockCharacterDetail.data,
					chatRefs: [{ id: 'chat-1', sortOrder: 'a' }]
				}
			};
			activeCharacter.set(charWithRefs);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			await moveCharacterItem('char-1', 'chats', 'chat-1', 'folder-1');

			expect(get(activeCharacter)?.data.chatRefs?.[0].folderId).toBe('folder-1');
		});
	});
});
