import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	selectChat,
	clearActiveChat,
	createChat,
	updateChat,
	updateChatData,
	updateChatFull,
	deleteChat,
	createChatLorebook,
	deleteChatLorebook,
	createChatFolder,
	updateChatFolder,
	deleteChatFolder,
	moveChatLorebook
} from '$lib/stores/content/chat';
import { chats, activeChat, activeCharacter, messages, chatLorebooks } from '$lib/stores/state';
import { ChatService, LorebookService, CharacterService } from '$lib/services';
import { loadInitialMessages } from '$lib/stores/content/message';
import { AppError } from '$lib/shared/errors';
import { generateId } from '$lib/shared/id';
import type {
	ChatDetail,
	Chat,
	Lorebook,
	CharacterDetail,
	CharacterDataFields,
	ChatDataFields,
	ChatSummaryFields
} from '$lib/services';
import type { FolderDef } from '$lib/shared/types';

// Mock Services
vi.mock('$lib/services', () => ({
	ChatService: {
		getDetail: vi.fn(),
		create: vi.fn(),
		updateSummary: vi.fn(),
		updateData: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	},
	LorebookService: {
		create: vi.fn(),
		delete: vi.fn(),
		listByOwner: vi.fn()
	},
	CharacterService: {
		getDetail: vi.fn(),
		updateData: vi.fn()
	}
}));

// Mock Message Store Logic
vi.mock('$lib/stores/content/message', () => ({
	loadInitialMessages: vi.fn()
}));

// Mock Shared
vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/shared/ordering', () => ({
	generateSortOrder: vi.fn(() => 'sort-order'),
	sortByRefs: vi.fn((list) => list)
}));

describe('Chat Store', () => {
	const mockChat: Chat = {
		id: 'chat-1',
		characterId: 'char-1',
		title: 'Test Chat',
		lastMessagePreview: '',
		messageCount: 0
	};

	const mockChatDetail: ChatDetail = {
		...mockChat,
		data: {
			lorebookRefs: [],
			folders: {}
		}
	};

	const mockCharacterDetail: CharacterDetail = {
		id: 'char-1',
		name: 'Test Character',
		shortDescription: '',
		data: {
			systemPrompt: '',
			chatRefs: []
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		chats.set([]);
		activeChat.set(null);
		activeCharacter.set({ id: 'char-1' } as CharacterDetail);
		messages.set([]);
		chatLorebooks.set([]);
	});

	describe('selectChat', () => {
		it('should set active chat and load related data', async () => {
			vi.mocked(ChatService.getDetail).mockResolvedValue(mockChatDetail);
			vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			await selectChat('chat-1', 'char-1');

			expect(get(activeChat)).toEqual(mockChatDetail);
			expect(loadInitialMessages).toHaveBeenCalledWith('chat-1', 50);
			expect(get(chatLorebooks)).toEqual([]);
			expect(CharacterService.updateData).toHaveBeenCalledWith('char-1', {
				lastActiveChatId: 'chat-1'
			});
		});

		it('should throw error if chat not found', async () => {
			vi.mocked(ChatService.getDetail).mockResolvedValue(null);

			await expect(selectChat('invalid', 'char-1')).rejects.toThrow(AppError);
		});
	});

	describe('createChat', () => {
		it('should create chat and update character refs', async () => {
			activeCharacter.set(mockCharacterDetail);
			vi.mocked(ChatService.create).mockResolvedValue(mockChatDetail);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);

			const result = await createChat('char-1', { title: 'New Chat' });

			expect(result).toEqual(mockChatDetail);
			expect(CharacterService.updateData).toHaveBeenCalledWith('char-1', {
				chatRefs: expect.arrayContaining([expect.objectContaining({ id: 'chat-1' })])
			});
			expect(get(chats)).toContainEqual(mockChatDetail);
		});

		it('should roll back if character update fails', async () => {
			activeCharacter.set(mockCharacterDetail);
			vi.mocked(ChatService.create).mockResolvedValue(mockChatDetail);
			vi.mocked(CharacterService.updateData).mockRejectedValue(new Error('Fail'));

			await expect(createChat('char-1')).rejects.toThrow();
			expect(ChatService.delete).toHaveBeenCalledWith('chat-1', 'char-1');
		});
	});

	describe('deleteChat', () => {
		it('should delete chat and remove from character refs', async () => {
			const charWithRefs = {
				...mockCharacterDetail,
				data: { ...mockCharacterDetail.data, chatRefs: [{ id: 'chat-1', sortOrder: 'a' }] }
			};
			activeCharacter.set(charWithRefs);
			chats.set([mockChat]);
			vi.mocked(CharacterService.updateData).mockResolvedValue({} as CharacterDataFields);
			vi.mocked(ChatService.delete).mockResolvedValue(undefined);

			await deleteChat('chat-1', 'char-1');

			expect(get(chats)).toHaveLength(0);
			expect(CharacterService.updateData).toHaveBeenCalledWith('char-1', { chatRefs: [] });
		});
	});

	describe('Folder Management', () => {
		it('should create a chat lorebook folder', async () => {
			activeChat.set(mockChatDetail);
			vi.mocked(ChatService.updateData).mockResolvedValue({} as ChatDataFields);

			const folder = await createChatFolder('chat-1', 'My Folder');

			expect(folder.name).toBe('My Folder');
			expect(get(activeChat)?.data.folders?.lorebooks).toContainEqual(folder);
		});

		it('should update a chat lorebook folder', async () => {
			const folder: FolderDef = { id: 'f1', name: 'Old', sortOrder: 'a' };
			const chatWithFolder = {
				...mockChatDetail,
				data: { ...mockChatDetail.data, folders: { lorebooks: [folder] } }
			};
			activeChat.set(chatWithFolder);
			vi.mocked(ChatService.updateData).mockResolvedValue({} as ChatDataFields);

			await updateChatFolder('chat-1', 'f1', { name: 'New' });

			expect(get(activeChat)?.data.folders?.lorebooks?.[0].name).toBe('New');
		});
	});

	describe('moveChatLorebook', () => {
		it('should move lorebook to a different folder', async () => {
			const chatWithRefs = {
				...mockChatDetail,
				data: {
					...mockChatDetail.data,
					lorebookRefs: [{ id: 'lb-1', sortOrder: 'a' }]
				}
			};
			activeChat.set(chatWithRefs);
			vi.mocked(ChatService.updateData).mockResolvedValue({} as ChatDataFields);

			await moveChatLorebook('chat-1', 'lb-1', 'folder-1');

			expect(get(activeChat)?.data.lorebookRefs?.[0].folderId).toBe('folder-1');
		});
	});
});
