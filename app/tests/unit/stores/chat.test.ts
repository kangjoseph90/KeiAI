import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    selectChat,
    clearActiveChat,
    createChat,
    updateChat,
    deleteChat,
    addChatPersona,
    removeChatPersona,
    setChatDefaultCharacter,
    setChatDefaultPersona,
    setChatPersonaEnabled,
    setChatSelectedCharacter,
    setChatSelectedPersona,
    createChatLorebook,
    deleteChatLorebook,
    createChatFolder,
    updateChatFolder,
    deleteChatFolder,
    moveChatItem
} from '$lib/stores/content/chat';
import {
    activeChat,
    activeRoom,
    activeRoomId,
    chats,
    messages,
    chatLorebooks,
    chatPersonas
} from '$lib/stores/state';
import { ChatService, LorebookService } from '$lib/services';
import { loadInitialMessages } from '$lib/stores/content/message';
import { getPersona } from '$lib/stores/content/persona';
import { getRoom, updateRoom } from '$lib/stores/content/room';
import { AppError } from '$lib/types/errors';
import type { Chat, Lorebook, Room } from '$lib/services';
import type { FolderDef } from '$lib/types/refs';

vi.mock('$lib/services', () => ({
    ChatService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
    },
    LorebookService: {
        create: vi.fn(),
        delete: vi.fn(),
        listByOwner: vi.fn()
    }
}));

vi.mock('$lib/stores/content/message', () => ({
    loadInitialMessages: vi.fn()
}));

vi.mock('$lib/stores/content/persona', () => ({
    getPersona: vi.fn()
}));

vi.mock('$lib/stores/content/room', () => ({
    getRoom: vi.fn(),
    updateRoom: vi.fn()
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'new-id')
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: vi.fn(() => 'sort-order'),
    sortByRefs: vi.fn((list) => list)
}));

describe('Chat Store', () => {
    const mockRoom: Room = {
        id: 'room-1',
        name: 'Test Room',
        chats: { refs: {}, folders: {} },
        characters: {
            refs: { 'char-1': { id: 'char-1', sortOrder: 'a', enabled: true } },
            folders: {}
        }
    };

    const mockChat: Chat = {
        id: 'chat-1',
        roomId: 'room-1',
        title: 'Test Chat',
        chatNote: '',
        lorebooks: { refs: {}, folders: {} },
        personas: { refs: {}, folders: {} }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        chats.clear();
        activeChat.set(null);
        activeRoom.set(mockRoom);
        messages.clear();
        chatLorebooks.clear();
        chatPersonas.clear();
        vi.mocked(getRoom).mockResolvedValue(mockRoom);
        vi.mocked(updateRoom).mockResolvedValue(undefined);
        vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
    });

    describe('selectChat', () => {
        it('sets active chat and loads chat resources', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(mockChat);

            await selectChat('chat-1');

            expect(get(activeChat)).toEqual(mockChat);
            expect(loadInitialMessages).toHaveBeenCalledWith('chat-1', 50);
            expect(get(chatLorebooks)).toEqual([]);
            expect(updateRoom).toHaveBeenCalledWith('room-1', { lastActiveChatId: 'chat-1' });
        });

        it('cleans stale persona refs on select', async () => {
            const chat: Chat = {
                ...mockChat,
                selectedPersonaId: 'persona-missing',
                defaultPersonaId: 'persona-missing',
                personas: {
                    refs: {
                        'persona-missing': {
                            id: 'persona-missing',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    folders: {}
                }
            };
            vi.mocked(ChatService.get).mockResolvedValue(chat);
            vi.mocked(getPersona).mockResolvedValue(null);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...chat,
                selectedPersonaId: undefined,
                defaultPersonaId: undefined,
                personas: { refs: {}, folders: {} }
            });

            await selectChat('chat-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: { refs: { 'persona-missing': undefined } },
                    selectedPersonaId: undefined,
                    defaultPersonaId: undefined
                })
            );
        });

        it('cleans disabled selected/default refs on select', async () => {
            const chat: Chat = {
                ...mockChat,
                selectedPersonaId: 'persona-1',
                defaultPersonaId: 'persona-1',
                selectedCharacterId: 'char-disabled',
                defaultCharacterId: 'char-disabled',
                personas: {
                    refs: {
                        'persona-1': {
                            id: 'persona-1',
                            sortOrder: 'a',
                            enabled: false
                        }
                    },
                    folders: {}
                }
            };
            vi.mocked(ChatService.get).mockResolvedValue(chat);
            vi.mocked(getPersona).mockResolvedValue({
                id: 'persona-1',
                name: 'Persona',
                description: '',
                assets: []
            });
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: {
                        'char-disabled': {
                            id: 'char-disabled',
                            sortOrder: 'a',
                            enabled: false
                        }
                    },
                    folders: {}
                }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...chat,
                selectedPersonaId: undefined,
                defaultPersonaId: undefined,
                selectedCharacterId: undefined,
                defaultCharacterId: undefined
            });

            await selectChat('chat-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    selectedPersonaId: undefined,
                    defaultPersonaId: undefined,
                    selectedCharacterId: undefined,
                    defaultCharacterId: undefined
                })
            );
        });

        it('throws if chat not found', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(null);

            await expect(selectChat('invalid')).rejects.toThrow(AppError);
        });
    });

    describe('createChat', () => {
        it('creates chat and updates room refs', async () => {
            vi.mocked(ChatService.create).mockResolvedValue(mockChat);

            const result = await createChat('room-1', { title: 'New Chat' });

            expect(result).toEqual(mockChat);
            expect(updateRoom).toHaveBeenCalledWith('room-1', {
                chats: { refs: { 'chat-1': { id: 'chat-1', sortOrder: 'sort-order' } } }
            });
            expect(get(chats)).toContainEqual(mockChat);
        });

        it('rolls back if room update fails', async () => {
            vi.mocked(ChatService.create).mockResolvedValue(mockChat);
            vi.mocked(updateRoom).mockRejectedValue(new Error('Fail'));

            await expect(createChat('room-1')).rejects.toThrow();
            expect(ChatService.delete).toHaveBeenCalledWith('chat-1');
        });
    });

    describe('deleteChat', () => {
        it('deletes chat and removes it from room refs', async () => {
            const roomWithRefs: Room = {
                ...mockRoom,
                chats: { refs: { 'chat-1': { id: 'chat-1', sortOrder: 'a' } }, folders: {} }
            };
            vi.mocked(getRoom).mockResolvedValue(roomWithRefs);
            chats.setAll([mockChat]);
            activeChat.set(mockChat);
            vi.mocked(ChatService.delete).mockResolvedValue(undefined);

            await deleteChat('chat-1', 'room-1');

            expect(updateRoom).toHaveBeenCalledWith('room-1', {
                chats: { refs: { 'chat-1': undefined } }
            });
            expect(get(chats)).toHaveLength(0);
            expect(get(activeChat)).toBeNull();
        });
    });

    describe('Chat persona and character selection', () => {
        it('adds a persona ref and allows selecting/defaulting enabled personas', async () => {
            const persona = { id: 'persona-1', name: 'Persona', description: '', assets: [] };
            activeChat.set(mockChat);
            vi.mocked(getPersona).mockResolvedValue(persona);
            vi.mocked(ChatService.update).mockImplementation(
                async (_id, changes) =>
                    ({
                        ...mockChat,
                        ...changes,
                        personas: {
                            refs: {
                                'persona-1': {
                                    id: 'persona-1',
                                    sortOrder: 'sort-order',
                                    enabled: true
                                }
                            },
                            folders: {}
                        }
                    }) as Chat
            );

            await addChatPersona('chat-1', 'persona-1');
            await setChatSelectedPersona('chat-1', 'persona-1');
            await setChatDefaultPersona('chat-1', 'persona-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: {
                        refs: {
                            'persona-1': expect.objectContaining({
                                id: 'persona-1',
                                enabled: true
                            })
                        }
                    }
                })
            );
            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                selectedPersonaId: 'persona-1'
            });
            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                defaultPersonaId: 'persona-1'
            });
            expect(get(chatPersonas)).toContainEqual(persona);
        });

        it('rejects selecting persona refs that are missing or disabled', async () => {
            activeChat.set({
                ...mockChat,
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a', enabled: false } },
                    folders: {}
                }
            });

            await expect(setChatSelectedPersona('chat-1', 'persona-1')).rejects.toThrow(AppError);
            await expect(setChatDefaultPersona('chat-1', 'persona-missing')).rejects.toThrow(
                AppError
            );
        });

        it('clears selected/default persona when removing or disabling it', async () => {
            activeChat.set({
                ...mockChat,
                selectedPersonaId: 'persona-1',
                defaultPersonaId: 'persona-1',
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a', enabled: true } },
                    folders: {}
                }
            });
            vi.mocked(ChatService.update).mockImplementation(
                async (_id, changes) =>
                    ({
                        ...mockChat,
                        ...changes,
                        personas: { refs: {}, folders: {} }
                    }) as Chat
            );

            await removeChatPersona('chat-1', 'persona-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: { refs: { 'persona-1': undefined } },
                    selectedPersonaId: undefined,
                    defaultPersonaId: undefined
                })
            );

            activeChat.set({
                ...mockChat,
                selectedPersonaId: 'persona-1',
                defaultPersonaId: 'persona-1',
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a', enabled: true } },
                    folders: {}
                }
            });

            await setChatPersonaEnabled('chat-1', 'persona-1', false);

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: {
                        refs: {
                            'persona-1': expect.objectContaining({ enabled: false })
                        }
                    },
                    selectedPersonaId: undefined,
                    defaultPersonaId: undefined
                })
            );
        });

        it('allows selecting/defaulting enabled room characters and rejects disabled ones', async () => {
            activeChat.set(mockChat);

            await setChatSelectedCharacter('chat-1', 'char-1');
            await setChatDefaultCharacter('chat-1', 'char-1');

            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                selectedCharacterId: 'char-1'
            });
            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                defaultCharacterId: 'char-1'
            });

            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: { 'char-1': { id: 'char-1', sortOrder: 'a', enabled: false } },
                    folders: {}
                }
            });

            await expect(setChatSelectedCharacter('chat-1', 'char-1')).rejects.toThrow(AppError);
            await expect(setChatDefaultCharacter('chat-1', 'char-missing')).rejects.toThrow(
                AppError
            );
        });
    });

    describe('Folder Management', () => {
        beforeEach(() => {
            activeChat.set(mockChat);
        });

        it('creates a chat lorebook folder', async () => {
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: {
                    refs: {},
                    folders: {
                        'new-id': { id: 'new-id', name: 'My Folder', sortOrder: 'sort-order' }
                    }
                }
            });

            const folder = await createChatFolder('chat-1', 'lorebooks', 'My Folder');

            expect(folder.name).toBe('My Folder');
            expect(get(activeChat)?.lorebooks.folders['new-id']).toEqual(folder);
        });

        it('updates a chat lorebook folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Old', sortOrder: 'a' };
            activeChat.set({
                ...mockChat,
                lorebooks: { refs: {}, folders: { f1: folder } }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: { refs: {}, folders: { f1: { ...folder, name: 'New' } } }
            });

            await updateChatFolder('chat-1', 'lorebooks', 'f1', { name: 'New' });

            expect(get(activeChat)?.lorebooks.folders.f1?.name).toBe('New');
        });

        it('deletes a chat lorebook folder', async () => {
            const folder: FolderDef = { id: 'f1', name: 'Delete Me', sortOrder: 'a' };
            activeChat.set({
                ...mockChat,
                lorebooks: { refs: {}, folders: { f1: folder } }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: { refs: {}, folders: {} }
            });

            await deleteChatFolder('chat-1', 'lorebooks', 'f1');

            expect(Object.keys(get(activeChat)?.lorebooks.folders ?? {})).toHaveLength(0);
        });
    });

    describe('moveChatItem', () => {
        it('moves lorebook to a different folder', async () => {
            activeChat.set({
                ...mockChat,
                lorebooks: { refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a' } }, folders: {} }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: {
                    refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a', folderId: 'folder-1' } },
                    folders: {}
                }
            });

            await moveChatItem('chat-1', 'lorebooks', 'lb-1', 'folder-1');

            expect(get(activeChat)?.lorebooks.refs['lb-1']?.folderId).toBe('folder-1');
        });
    });

    describe('Chat-owned lorebooks', () => {
        it('creates and registers a chat lorebook', async () => {
            const lorebook = { id: 'lb-1', ownerId: 'chat-1', name: 'LB' } as unknown as Lorebook;
            activeChat.set(mockChat);
            vi.mocked(LorebookService.create).mockResolvedValue(lorebook);
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: {
                    refs: { 'lb-1': { id: 'lb-1', sortOrder: 'sort-order' } },
                    folders: {}
                }
            });

            const result = await createChatLorebook('chat-1', { name: 'LB' } as never);

            expect(result).toBe(lorebook);
            expect(get(chatLorebooks)).toContainEqual(lorebook);
        });

        it('removes a chat lorebook ref and deletes the lorebook', async () => {
            activeChat.set({
                ...mockChat,
                lorebooks: { refs: { 'lb-1': { id: 'lb-1', sortOrder: 'a' } }, folders: {} }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...mockChat,
                lorebooks: { refs: {}, folders: {} }
            });
            vi.mocked(LorebookService.delete).mockResolvedValue(undefined);

            await deleteChatLorebook('chat-1', 'lb-1');

            expect(LorebookService.delete).toHaveBeenCalledWith('lb-1');
        });
    });

    it('clearActiveChat clears chat-level stores', () => {
        activeChat.set(mockChat);
        messages.setAll([{ id: 'msg-1', chatId: 'chat-1' } as never]);
        chatLorebooks.setAll([{ id: 'lb-1' } as never]);
        chatPersonas.setAll([{ id: 'persona-1' } as never]);

        clearActiveChat();

        expect(get(activeChat)).toBeNull();
        expect(get(messages)).toEqual([]);
        expect(get(chatLorebooks)).toEqual([]);
        expect(get(chatPersonas)).toEqual([]);
    });
});
