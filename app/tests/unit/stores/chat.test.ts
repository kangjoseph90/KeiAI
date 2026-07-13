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
    activeChatId,
    activeRoomId,
    rooms,
    roomChats,
    messages,
    chatLorebooks,
    chatPersonas,
    chatSelections,
    personas
} from '$lib/stores/state';
import { ChatService, LorebookService } from '$lib/services';
import { loadInitialMessages } from '$lib/stores/content/message';
import { getPersona } from '$lib/stores/content/persona';
import { getRoom, updateRoom } from '$lib/stores/content/room';
import { AppError } from '$lib/types/errors';
import type { Chat, Lorebook, Room } from '$lib/services';
import type { FolderDef } from '$lib/types/refs';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

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
    loadInitialMessages: vi.fn(),
    repairChatMessageRefs: vi.fn()
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

vi.mock('$lib/adapters/cache', () => ({
    createCache: () => ({
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        load: vi.fn().mockResolvedValue(undefined),
        flush: vi.fn().mockResolvedValue(undefined)
    })
}));

describe('Chat Store', () => {
    const mockRoom: Room = {
        id: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Test Room',
        chats: { refs: {}, folders: {} },
        characters: {
            refs: { 'char-1': { id: 'char-1', sortOrder: 'a' } },
            folders: {}
        }
    };

    const mockChat: Chat = {
        id: 'chat-1',
        roomId: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        title: 'Test Chat',
        chatNote: '',
        messageCount: 0,
        lorebooks: { refs: {}, folders: {} },
        personas: { refs: {}, folders: {} },
        inlays: { refs: {}, folders: {} }
    };

    function putActiveChat(chat: Chat): void {
        roomChats.set(chat.id, chat);
        activeChatId.set(chat.id);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        roomChats.clear();
        activeChatId.set(null);
        rooms.clear();
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);
        messages.clear();
        chatLorebooks.clear();
        personas.clear();
        chatSelections.set(null);
        vi.mocked(getRoom).mockResolvedValue(mockRoom);
        vi.mocked(updateRoom).mockResolvedValue(undefined);
        vi.mocked(LorebookService.listByOwner).mockResolvedValue([]);
        vi.mocked(ChatService.update).mockImplementation(async (chatId, changes) => {
            const current = roomChats.get(chatId) ?? mockChat;
            return { ...current, ...changes } as Chat;
        });
    });

    describe('selectChat', () => {
        it('sets active chat and loads chat resources', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(mockChat);

            await selectChat('chat-1');

            expect(get(activeChat)?.id).toBe(mockChat.id);
            expect(loadInitialMessages).toHaveBeenCalledWith('chat-1', 30, expect.any(Function));
            expect(get(chatLorebooks)).toEqual([]);
            expect(updateRoom).toHaveBeenCalledWith('room-1', { lastActiveChatId: 'chat-1' });
        });

        it('cleans stale persona refs on select', async () => {
            const chat: Chat = {
                ...mockChat,
                defaultPersonaId: 'persona-missing',
                personas: {
                    refs: {
                        'persona-missing': {
                            id: 'persona-missing',
                            sortOrder: 'a'
                        }
                    },
                    folders: {}
                }
            };
            vi.mocked(ChatService.get).mockResolvedValue(chat);
            vi.mocked(getPersona).mockResolvedValue(null);

            await selectChat('chat-1');

            // First call: stale ref cleanup
            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: { refs: { 'persona-missing': undefined } }
                })
            );
        });

        it('cleans detached default refs on select', async () => {
            const chat: Chat = {
                ...mockChat,
                defaultPersonaId: 'persona-1',
                defaultCharacterId: 'char-disabled',
                personas: { refs: {}, folders: {} }
            };
            vi.mocked(ChatService.get).mockResolvedValue(chat);
            vi.mocked(getPersona).mockResolvedValue(null);
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: { refs: {}, folders: {} }
            });
            vi.mocked(ChatService.update).mockResolvedValue({
                ...chat,
                defaultPersonaId: undefined,
                defaultCharacterId: undefined
            });

            await selectChat('chat-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    defaultPersonaId: undefined,
                    defaultCharacterId: undefined
                })
            );
        });

        it('throws if chat not found', async () => {
            vi.mocked(ChatService.get).mockResolvedValue(null);

            await expect(selectChat('invalid')).rejects.toThrow(AppError);
        });

        it('drops stale results when a newer chat is selected', async () => {
            const firstChat = deferred<Chat | null>();
            const secondChat: Chat = { ...mockChat, id: 'chat-2', title: 'Second Chat' };
            vi.mocked(ChatService.get).mockImplementation((chatId) =>
                chatId === 'chat-1' ? firstChat.promise : Promise.resolve(secondChat)
            );

            const firstSelection = selectChat('chat-1');
            const secondSelection = selectChat('chat-2');
            firstChat.resolve(mockChat);
            await Promise.all([firstSelection, secondSelection]);

            expect(get(activeChat)?.id).toBe('chat-2');
            expect(loadInitialMessages).toHaveBeenCalledTimes(1);
            expect(loadInitialMessages).toHaveBeenCalledWith('chat-2', 30, expect.any(Function));
            expect(updateRoom).not.toHaveBeenCalledWith('room-1', {
                lastActiveChatId: 'chat-1'
            });
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
            expect(get(roomChats)).toContainEqual(mockChat);
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
                chats: {
                    refs: {
                        'chat-1': { id: 'chat-1', sortOrder: 'a' },
                        'chat-2': { id: 'chat-2', sortOrder: 'b' }
                    },
                    folders: {}
                }
            };
            vi.mocked(getRoom).mockResolvedValue(roomWithRefs);
            roomChats.setAll([mockChat]);
            putActiveChat(mockChat);
            vi.mocked(ChatService.delete).mockResolvedValue(undefined);

            await deleteChat('chat-1', 'room-1');

            expect(updateRoom).toHaveBeenCalledWith('room-1', {
                chats: { refs: { 'chat-1': undefined } }
            });
            expect(get(roomChats)).toHaveLength(0);
            expect(get(activeChat)).toBeNull();
        });

        it("rejects deleting the room's last chat", async () => {
            const roomWithLastChat: Room = {
                ...mockRoom,
                chats: { refs: { 'chat-1': { id: 'chat-1', sortOrder: 'a' } }, folders: {} }
            };
            vi.mocked(getRoom).mockResolvedValue(roomWithLastChat);

            await expect(deleteChat('chat-1', 'room-1')).rejects.toMatchObject({
                code: 'DELETE_LAST_ITEM'
            });
            expect(ChatService.delete).not.toHaveBeenCalled();
        });
    });

    describe('Chat persona and character selection', () => {
        it('adds a persona ref and allows selecting and defaulting it', async () => {
            const persona = {
                id: 'persona-1',
                scopeType: 'user' as const,
                scopeId: 'user-1',
                name: 'Persona',
                description: '',
                assets: { refs: {}, folders: {} }
            };
            putActiveChat(mockChat);
            personas.set(persona.id, persona);
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
                                    sortOrder: 'sort-order'
                                }
                            },
                            folders: {}
                        }
                    }) as Chat
            );

            await addChatPersona('chat-1', 'persona-1');
            setChatSelectedPersona('chat-1', 'persona-1');
            await setChatDefaultPersona('chat-1', 'persona-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: {
                        refs: {
                            'persona-1': expect.objectContaining({
                                id: 'persona-1',
                                sortOrder: 'sort-order'
                            })
                        }
                    }
                })
            );
            expect(get(chatSelections)?.personaId).toBe('persona-1');
            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                defaultPersonaId: 'persona-1'
            });
            expect(get(chatPersonas)).toContainEqual(persona);
        });

        it('rejects defaulting persona refs that are missing', async () => {
            putActiveChat({
                ...mockChat,
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a' } },
                    folders: {}
                }
            });

            await expect(setChatDefaultPersona('chat-1', 'persona-missing')).rejects.toThrow(
                AppError
            );
        });

        it('clears default persona when removing it', async () => {
            putActiveChat({
                ...mockChat,
                defaultPersonaId: 'persona-1',
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a' } },
                    folders: {}
                }
            });
            chatSelections.set({ personaId: 'persona-1' });

            await removeChatPersona('chat-1', 'persona-1');

            expect(ChatService.update).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    personas: { refs: { 'persona-1': undefined } }
                })
            );
            expect(get(chatSelections)?.personaId).toBeUndefined();
        });

        it('allows selecting and defaulting attached room characters', async () => {
            putActiveChat(mockChat);

            setChatSelectedCharacter('chat-1', 'char-1');
            await setChatDefaultCharacter('chat-1', 'char-1');

            expect(get(chatSelections)?.characterId).toBe('char-1');
            expect(ChatService.update).toHaveBeenCalledWith('chat-1', {
                defaultCharacterId: 'char-1'
            });

            await expect(setChatDefaultCharacter('chat-1', 'char-missing')).rejects.toThrow(
                AppError
            );
        });
    });

    describe('Folder Management', () => {
        beforeEach(() => {
            putActiveChat(mockChat);
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
            putActiveChat({
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
            putActiveChat({
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
            putActiveChat({
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
            putActiveChat(mockChat);
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
            putActiveChat({
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
        personas.set('persona-1', { id: 'persona-1' } as never);
        putActiveChat({
            ...mockChat,
            personas: {
                refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a' } },
                folders: {}
            }
        });
        messages.setAll([{ id: 'msg-1', chatId: 'chat-1' } as never]);
        chatLorebooks.setAll([{ id: 'lb-1' } as never]);

        clearActiveChat();

        expect(get(activeChat)).toBeNull();
        expect(get(messages)).toEqual([]);
        expect(get(chatLorebooks)).toEqual([]);
        expect(get(chatPersonas)).toEqual([]);
    });
});
