import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    selectChat,
    clearActiveChat,
    createChat,
    updateChat,
    deleteChat,
    createChatLorebook,
    deleteChatLorebook,
    createChatFolder,
    updateChatFolder,
    deleteChatFolder,
    moveChatItem
} from '$lib/stores/content/chat';
import { chats, activeChat, activeCharacter, messages, chatLorebooks } from '$lib/stores/state';
import { ChatService, LorebookService, CharacterService, MessageService } from '$lib/services';
import { loadInitialMessages } from '$lib/stores/content/message';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { Chat, Message, Lorebook, Character } from '$lib/services';
import type { FolderDef } from '$lib/types/refs';

// Mock Services
vi.mock('$lib/services', () => ({
    ChatService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
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
    CharacterService: {
        get: vi.fn(),
        update: vi.fn()
    },
    MessageService: {
        get: vi.fn(),
        getMessagesBefore: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        countByChat: vi.fn()
    }
}));

vi.mock('$lib/stores/content/message', () => ({
    loadInitialMessages: vi.fn()
}));

// Mock Shared
vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: vi.fn(() => 'sort-order'),
    sortByRefs: vi.fn((list) => list)
}));

describe('Chat Store', () => {
    const mockChat: Chat = {
        id: 'chat-1',
        characterId: 'char-1',
        title: 'Test Chat',
        chatNote: ''
    };

    const mockCharacter: Character = {
        id: 'char-1',
        name: 'Test Character',
        description: '',
        characterNote: '',
        greetings: {},
        allowLowLevel: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        chats.clear();
        activeChat.set(null);
        activeCharacter.set(mockCharacter);
        messages.clear();
        chatLorebooks.clear();
    });

    describe('selectChat', () => {
        it('should set active chat and load related data', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(mockChat);
            vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
            vi.mocked(CharacterService.update).mockResolvedValue(mockCharacter);

            await selectChat('chat-1', 'char-1');

            expect(get(activeChat)).toEqual(mockChat);
            expect(loadInitialMessages).toHaveBeenCalledWith('chat-1', 50);
            expect(get(chatLorebooks)).toEqual([]);
            expect(CharacterService.update).toHaveBeenCalledWith('char-1', {
                lastActiveChatId: 'chat-1'
            });
        });

        it('should throw error if chat not found', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(null);

            await expect(selectChat('invalid', 'char-1')).rejects.toThrow(AppError);
        });
    });

    describe('createChat', () => {
        it('should create chat and update character refs', async () => {
            activeCharacter.set(mockCharacter);
            vi.mocked(ChatService.create).mockResolvedValue(mockChat);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                chats: { refs: { 'chat-1': { id: 'chat-1', sortOrder: 'sort-order' } } }
            });

            const result = await createChat('char-1', { title: 'New Chat' });

            expect(result).toEqual(mockChat);
            expect(CharacterService.update).toHaveBeenCalledWith(
                'char-1',
                expect.objectContaining({
                    chats: expect.objectContaining({
                        refs: expect.objectContaining({
                            'chat-1': expect.objectContaining({ id: 'chat-1' })
                        })
                    })
                })
            );
            expect(get(chats)).toContainEqual(mockChat);
        });

        it('should roll back if character update fails', async () => {
            activeCharacter.set(mockCharacter);
            vi.mocked(ChatService.create).mockResolvedValue(mockChat);
            vi.mocked(CharacterService.update).mockRejectedValue(new Error('Fail'));

            await expect(createChat('char-1')).rejects.toThrow();
            expect(ChatService.delete).toHaveBeenCalledWith('chat-1');
        });
    });

    describe('deleteChat', () => {
        it('should delete chat and remove from character refs', async () => {
            const charWithRefs = {
                ...mockCharacter,
                chats: { refs: { 'chat-1': { id: 'chat-1', sortOrder: 'a' } } }
            };
            activeCharacter.set(charWithRefs);
            chats.setAll([mockChat]);
            vi.mocked(CharacterService.update).mockResolvedValue({
                ...mockCharacter,
                chats: { refs: {} }
            });
            vi.mocked(ChatService.delete).mockResolvedValue(undefined);

            await deleteChat('chat-1', 'char-1');

            expect(get(chats)).toHaveLength(0);
            expect(CharacterService.update).toHaveBeenCalledWith('char-1', {
                chats: { refs: { 'chat-1': undefined } }
            });
        });
    });

    describe('Folder Management', () => {
        it('should create a chat lorebook folder', async () => {
            activeChat.set(mockChat);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: {
                    folders: {
                        'new-id': { id: 'new-id', name: 'My Folder', sortOrder: 'sort-order' }
                    }
                }
            });

            const folder = await createChatFolder('chat-1', 'lorebooks', 'My Folder');

            expect(folder.name).toBe('My Folder');
            expect(get(activeChat)?.lorebooks?.folders?.['new-id']).toEqual(folder);
        });

        it('should update a chat lorebook folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Old', sortOrder: 'a' };
            const chatWithFolder = {
                ...mockChat,
                lorebooks: { folders: { f1: folder } }
            };
            activeChat.set(chatWithFolder);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: { folders: { f1: { ...folder, name: 'New' } } }
            });

            await updateChatFolder('chat-1', 'lorebooks', 'f1', { name: 'New' });

            expect(get(activeChat)?.lorebooks?.folders?.['f1']?.name).toBe('New');
        });

        it('should delete a chat lorebook folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Delete Me', sortOrder: 'a' };
            const chatWithFolder = {
                ...mockChat,
                lorebooks: { folders: { f1: folder } }
            };
            activeChat.set(chatWithFolder);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: { folders: {} }
            });

            await deleteChatFolder('chat-1', 'lorebooks', 'f1');

            expect(Object.keys(get(activeChat)?.lorebooks?.folders ?? {})).toHaveLength(0);
        });
    });

    describe('moveChatItem', () => {
        it('should move lorebook to a different folder', async () => {
            const chatWithRefs = {
                ...mockChat,
                lorebooks: { refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a' } } }
            };
            activeChat.set(chatWithRefs);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: {
                    refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a', folderId: 'folder-1' } }
                }
            });

            await moveChatItem('chat-1', 'lorebooks', 'lb-1', 'folder-1');

            expect(get(activeChat)?.lorebooks?.refs?.['lb-1']?.folderId).toBe('folder-1');
        });
    });
});
