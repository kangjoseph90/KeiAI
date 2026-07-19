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
    updateRoom
} from '$lib/stores/content/room';
import {
    activeChat,
    activeChatId,
    activeRoom,
    activeRoomId,
    chatPersonas,
    characters,
    messages,
    multiRooms,
    personas,
    roomChats,
    roomCharacters,
    rooms
} from '$lib/stores/state';
import { ChatService, RoomService } from '$lib/services';
import { getCharacter } from '$lib/stores/content/character';
import {
    clearActiveChat,
    ensureRoomHasChat,
    resolveChatSelections,
    selectChat,
    updateChat
} from '$lib/stores/content/chat';
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
    },
    SettingsService: {
        get: vi.fn().mockResolvedValue({
            rooms: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        }),
        update: vi.fn().mockResolvedValue({
            rooms: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        })
    }
}));

vi.mock('$lib/stores/content/character', () => ({
    getCharacter: vi.fn()
}));

vi.mock('$lib/stores/content/chat', () => ({
    clearActiveChat: vi.fn(),
    ensureRoomHasChat: vi.fn(),
    selectChat: vi.fn(),
    updateChat: vi.fn(),
    resolveChatSelections: vi.fn().mockResolvedValue(undefined)
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

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
                'char-1': { id: 'char-1', sortOrder: 'a' },
                staleChar: { id: 'staleChar', sortOrder: 'b' }
            },
            folders: {}
        },
        files: { refs: {}, folders: {} }
    };
    const mockChat: Chat = {
        id: 'chat-1',
        roomId: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        title: 'Chat 1',
        chatNote: '',
        messageCount: 0,
        lorebooks: { refs: {}, folders: {} },
        personas: { refs: {}, folders: {} },
        inlays: { refs: {}, folders: {} },
        files: { refs: {}, folders: {} }
    };
    const mockCharacter: Character = {
        id: 'char-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Character 1',
        description: '',
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

    beforeEach(() => {
        vi.clearAllMocks();
        rooms.clear();
        multiRooms.clear();
        characters.clear();
        personas.clear();
        roomChats.clear();
        activeRoomId.set(null);
        activeChatId.set(null);
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
        vi.mocked(ensureRoomHasChat).mockResolvedValue(mockChat);
        vi.mocked(selectChat).mockResolvedValue(undefined);
        vi.mocked(clearActiveChat).mockImplementation(() => {
            activeChatId.set(null);
            messages.clear();
        });
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
        expect(selectChat).toHaveBeenCalledWith('chat-1', expect.any(Function));
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

    it('drops stale results when a newer room is selected', async () => {
        const firstRoom = deferred<Room | null>();
        const secondRoom: Room = {
            ...mockRoom,
            id: 'room-2',
            name: 'Room 2',
            chats: { refs: { 'chat-2': { id: 'chat-2', sortOrder: 'a' } }, folders: {} },
            characters: {
                refs: { 'char-1': mockRoom.characters.refs['char-1'] },
                folders: {}
            }
        };
        const secondChat: Chat = { ...mockChat, id: 'chat-2', roomId: 'room-2' };
        vi.mocked(RoomService.get).mockImplementation((roomId) =>
            roomId === 'room-1' ? firstRoom.promise : Promise.resolve(secondRoom)
        );
        vi.mocked(ChatService.listByRoom).mockImplementation((roomId) =>
            Promise.resolve(roomId === 'room-2' ? [secondChat] : [mockChat])
        );

        const firstSelection = selectRoom('room-1');
        const secondSelection = selectRoom('room-2');
        firstRoom.resolve(mockRoom);
        await Promise.all([firstSelection, secondSelection]);

        expect(get(activeRoom)?.id).toBe('room-2');
        expect(ChatService.listByRoom).toHaveBeenCalledTimes(1);
        expect(ChatService.listByRoom).toHaveBeenCalledWith('room-2');
        expect(selectChat).toHaveBeenCalledWith('chat-2', expect.any(Function));
    });

    it('clears room-level and nested chat stores', () => {
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);
        roomChats.setAll([mockChat]);
        activeChatId.set(mockChat.id);
        messages.setAll([{ id: 'msg-1', chatId: 'chat-1' } as never]);

        clearActiveRoom();

        expect(get(activeRoom)).toBeNull();
        expect(get(activeChat)).toBeNull();
        expect(get(roomCharacters)).toEqual([]);
        expect(get(roomChats)).toEqual([]);
        expect(get(messages)).toEqual([]);
        expect(get(chatPersonas)).toEqual([]);
        expect(clearActiveChat).toHaveBeenCalled();
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

    it('adds a character ref to the active room and visible character list', async () => {
        const roomWithoutCharacters = { ...mockRoom, characters: { refs: {}, folders: {} } };
        rooms.set(roomWithoutCharacters.id, roomWithoutCharacters);
        activeRoomId.set(roomWithoutCharacters.id);
        vi.mocked(RoomService.update).mockResolvedValue({
            ...mockRoom,
            characters: {
                refs: { 'char-1': { id: 'char-1', sortOrder: 'sort-order' } },
                folders: {}
            }
        });

        await addRoomCharacter('room-1', 'char-1');

        expect(RoomService.update).toHaveBeenCalledWith('room-1', {
            characters: {
                refs: {
                    'char-1': expect.objectContaining({
                        id: 'char-1',
                        sortOrder: 'sort-order'
                    })
                }
            }
        });
        expect(get(roomCharacters)).toContainEqual(mockCharacter);
    });

    it('removes room character refs and resolves chat selections', async () => {
        rooms.set(mockRoom.id, mockRoom);
        activeRoomId.set(mockRoom.id);
        const selectedChat = {
            ...mockChat,
            defaultCharacterId: 'char-1'
        };
        roomChats.set(selectedChat.id, selectedChat);
        activeChatId.set(selectedChat.id);

        await removeRoomCharacter('room-1', 'char-1');

        expect(RoomService.update).toHaveBeenCalledWith('room-1', {
            characters: { refs: { 'char-1': undefined } }
        });
        expect(resolveChatSelections).toHaveBeenCalledWith('chat-1');
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
