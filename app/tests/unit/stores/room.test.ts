import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    addRoomCharacter,
    clearActiveRoom,
    createRoom,
    deleteRoom,
    loadRooms,
    moveRoomItem,
    removeRoomCharacter,
    selectRoom,
    setRoomCharacterEnabled,
    updateRoom
} from '$lib/stores/content/room';
import {
    activeChat,
    activeChatId,
    activeRoom,
    activeRoomId,
    chatLorebooks,
    chatPersonas,
    characters,
    messages,
    personas,
    roomChats,
    roomCharacters,
    rooms
} from '$lib/stores/state';
import { ChatService, RoomService } from '$lib/services';
import { getCharacter } from '$lib/stores/content/character';
import { updateChat } from '$lib/stores/content/chat';
import { AppError } from '$lib/types/errors';
import type { Character, Chat, Room } from '$lib/services';

vi.mock('$lib/services', () => ({
    RoomService: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateContent: vi.fn(),
        delete: vi.fn()
    },
    ChatService: {
        listByRoom: vi.fn()
    }
}));

vi.mock('$lib/stores/content/character', () => ({
    getCharacter: vi.fn()
}));

vi.mock('$lib/stores/content/chat', () => ({
    updateChat: vi.fn()
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'folder-new')
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: vi.fn(() => 'sort-order'),
    sortByRefs: vi.fn((list) => list)
}));

describe('Room Store', () => {
    const mockRoom: Room = {
        id: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Room 1',
        chats: {
            refs: {
                'chat-1': { id: 'chat-1', sortOrder: 'a' },
                staleChat: { id: 'staleChat', sortOrder: 'b' }
            },
            folders: {}
        },
        characters: {
            refs: {
                'char-1': { id: 'char-1', sortOrder: 'a', enabled: true },
                staleChar: { id: 'staleChar', sortOrder: 'b', enabled: true }
            },
            folders: {}
        }
    };
    const mockChat: Chat = {
        id: 'chat-1',
        roomId: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        title: 'Chat 1',
        chatNote: '',
        lorebooks: { refs: {}, folders: {} },
        personas: { refs: {}, folders: {} }
    };
    const mockCharacter: Character = {
        id: 'char-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Character 1',
        description: '',
        characterNote: '',
        greetings: {},
        defaultVariables: {},
        allowLowLevel: false,
        modules: { refs: {}, folders: {} },
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: { refs: {}, folders: {} }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        rooms.clear();
        characters.clear();
        personas.clear();
        roomChats.clear();
        activeRoomId.set(null);
        activeChatId.set(null);
        chatLorebooks.clear();
        messages.clear();
        characters.set(mockCharacter.id, mockCharacter);
        vi.mocked(RoomService.get).mockResolvedValue(mockRoom);
        vi.mocked(RoomService.update).mockImplementation(async (_id, changes) => {
            const next: Room = { ...mockRoom, ...changes } as Room;
            if (changes.characters?.refs) {
                next.characters = {
                    ...mockRoom.characters,
                    ...changes.characters,
                    refs: { ...mockRoom.characters.refs }
                } as Room['characters'];
                for (const [id, ref] of Object.entries(changes.characters.refs)) {
                    if (ref === undefined) {
                        delete next.characters.refs[id];
                    } else {
                        next.characters.refs[id] = ref as Room['characters']['refs'][string];
                    }
                }
            }
            if (changes.chats?.refs) {
                next.chats = {
                    ...mockRoom.chats,
                    ...changes.chats,
                    refs: { ...mockRoom.chats.refs }
                } as Room['chats'];
                for (const [id, ref] of Object.entries(changes.chats.refs)) {
                    if (ref === undefined) {
                        delete next.chats.refs[id];
                    } else {
                        next.chats.refs[id] = ref as Room['chats']['refs'][string];
                    }
                }
            }
            return next;
        });
        vi.mocked(ChatService.listByRoom).mockResolvedValue([mockChat]);
        vi.mocked(getCharacter).mockImplementation(async (id: string) =>
            id === 'char-1' ? mockCharacter : null
        );
        vi.mocked(updateChat).mockResolvedValue(undefined);
    });

    it('loads rooms into the room store', async () => {
        vi.mocked(RoomService.list).mockResolvedValue([mockRoom]);

        await loadRooms();

        expect(get(rooms)).toEqual([mockRoom]);
    });

    it('selects a room and clears stale character refs on entry', async () => {
        await selectRoom('room-1');

        expect(get(activeRoom)).toMatchObject({
            id: 'room-1',
            characters: { refs: { 'char-1': mockRoom.characters.refs['char-1'] } }
        });
        expect(get(roomChats)).toEqual([mockChat]);
        expect(get(roomCharacters)).toEqual([mockCharacter]);
        expect(RoomService.update).toHaveBeenCalledWith(
            'room-1',
            expect.objectContaining({
                characters: { refs: { staleChar: undefined } }
            })
        );
    });

    it('throws when selecting a missing room', async () => {
        vi.mocked(RoomService.get).mockResolvedValue(null);

        await expect(selectRoom('missing')).rejects.toThrow(AppError);
    });

    it('clears room-level and nested chat stores', () => {
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);
        roomChats.setAll([mockChat]);
        activeChatId.set(mockChat.id);
        messages.setAll([{ id: 'msg-1', chatId: 'chat-1' } as never]);
        chatLorebooks.setAll([{ id: 'lb-1' } as never]);

        clearActiveRoom();

        expect(get(activeRoom)).toBeNull();
        expect(get(activeChat)).toBeNull();
        expect(get(roomCharacters)).toEqual([]);
        expect(get(roomChats)).toEqual([]);
        expect(get(messages)).toEqual([]);
        expect(get(chatLorebooks)).toEqual([]);
        expect(get(chatPersonas)).toEqual([]);
    });

    it('creates, updates, and deletes rooms through the service', async () => {
        vi.mocked(RoomService.create).mockResolvedValue(mockRoom);

        await createRoom({ name: 'Room 1' });
        await updateRoom('room-1', { name: 'Updated' });
        await deleteRoom('room-1');

        expect(get(rooms).some((room) => room.id === 'room-1')).toBe(false);
        expect(RoomService.create).toHaveBeenCalledWith({ name: 'Room 1' });
        expect(RoomService.update).toHaveBeenCalledWith('room-1', { name: 'Updated' });
        expect(RoomService.delete).toHaveBeenCalledWith('room-1');
    });

    it('adds an enabled character ref to the active room and visible character list', async () => {
        const roomWithoutCharacters = { ...mockRoom, characters: { refs: {}, folders: {} } };
        rooms.set(roomWithoutCharacters.id, roomWithoutCharacters);
        activeRoomId.set(roomWithoutCharacters.id);
        vi.mocked(RoomService.update).mockResolvedValue({
            ...mockRoom,
            characters: {
                refs: { 'char-1': { id: 'char-1', sortOrder: 'sort-order', enabled: true } },
                folders: {}
            }
        });

        await addRoomCharacter('room-1', 'char-1');

        expect(RoomService.update).toHaveBeenCalledWith('room-1', {
            characters: {
                refs: {
                    'char-1': expect.objectContaining({
                        id: 'char-1',
                        sortOrder: 'sort-order',
                        enabled: true
                    })
                }
            }
        });
        expect(get(roomCharacters)).toContainEqual(mockCharacter);
    });

    it('removes room character refs and clears active chat selected/default character', async () => {
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);
        const selectedChat = {
            ...mockChat,
            selectedCharacterId: 'char-1',
            defaultCharacterId: 'char-1'
        };
        roomChats.set(selectedChat.id, selectedChat);
        activeChatId.set(selectedChat.id);

        await removeRoomCharacter('room-1', 'char-1');

        expect(RoomService.update).toHaveBeenCalledWith('room-1', {
            characters: { refs: { 'char-1': undefined } }
        });
        expect(get(roomCharacters)).toEqual([]);
        expect(updateChat).toHaveBeenCalledWith('chat-1', {
            selectedCharacterId: undefined,
            defaultCharacterId: undefined
        });
    });

    it('disabling the active selected character clears selected/default chat ids', async () => {
        const selectedChat = {
            ...mockChat,
            selectedCharacterId: 'char-1',
            defaultCharacterId: 'char-1'
        };
        roomChats.set(selectedChat.id, selectedChat);
        activeChatId.set(selectedChat.id);

        await setRoomCharacterEnabled('room-1', 'char-1', false);

        expect(RoomService.update).toHaveBeenCalledWith(
            'room-1',
            expect.objectContaining({
                characters: {
                    refs: {
                        'char-1': expect.objectContaining({ enabled: false })
                    }
                }
            })
        );
        expect(updateChat).toHaveBeenCalledWith('chat-1', {
            selectedCharacterId: undefined,
            defaultCharacterId: undefined
        });
    });

    it('moves room refs between folders without touching missing refs', async () => {
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);

        await moveRoomItem('room-1', 'characters', 'char-1', 'folder-1');
        await moveRoomItem('room-1', 'characters', 'missing', 'folder-1');

        expect(RoomService.update).toHaveBeenCalledTimes(1);
        expect(RoomService.update).toHaveBeenCalledWith('room-1', {
            characters: {
                refs: {
                    'char-1': expect.objectContaining({
                        folderId: 'folder-1',
                        sortOrder: 'a'
                    })
                }
            }
        });
    });
});
