import { get } from 'svelte/store';
import {
    RoomService,
    ChatService,
    MultiRoomService,
    type Room,
    type RoomFields,
    type RoomContent
} from '$lib/services';
import type { FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { getCharacter } from './character';
import { resolveChatSelections, selectChat, ensureRoomHasChat } from './chat';
import {
    rooms,
    multiRooms,
    isMultiRoom,
    activeRoom,
    activeRoomId,
    roomChats,
    activeChat,
    activeChatId,
    chatLorebooks,
    chatSelections,
    messages,
    messageIndexes,
    translations,
    multiRoomCharacters,
    multiRoomPersonas
} from '../state';
import { getAppSettings, updateSettings } from './settings';

export async function getRoom(roomId: string): Promise<Room | null> {
    const active = get(activeRoom);
    if (active?.id === roomId) return active;
    const cached = rooms.get(roomId);
    if (cached) return cached;
    const cachedMulti = multiRooms.get(roomId);
    if (cachedMulti) return cachedMulti;
    return RoomService.get(roomId);
}

export async function loadRooms(): Promise<void> {
    const settings = await getAppSettings();
    const list = await RoomService.list();
    rooms.setAll(sortByRefs(list, settings.rooms.refs));
}

export async function selectRoom(roomId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);
    if (room.scopeType === 'room') {
        throw new AppError('INVALID_INPUT', `Cannot select multi room with selectRoom: ${roomId}`);
    }

    clearActiveRoom();
    isMultiRoom.set(false);
    rooms.set(room.id, room);
    activeRoomId.set(room.id);

    const characterIds = Object.keys(room.characters.refs);
    const [chatList, characterEntries] = await Promise.all([
        ChatService.listByRoom(roomId),
        Promise.all(characterIds.map(async (id) => [id, await getCharacter(id)] as const))
    ]);

    const staleCharacterRefs: Record<string, undefined> = {};
    for (const [id, character] of characterEntries) {
        if (!character) {
            staleCharacterRefs[id] = undefined;
        }
    }

    roomChats.setAll(sortByRefs(chatList, room.chats.refs));

    if (Object.keys(staleCharacterRefs).length > 0) {
        await updateRoom(roomId, {
            characters: { refs: staleCharacterRefs }
        });
    }

    if (roomChats.size === 0) {
        await ensureRoomHasChat(roomId);
    }

    const lastActive = room.lastActiveChatId;
    const fallbackId = get(roomChats)[0]?.id;
    const targetId = lastActive && roomChats.get(lastActive) ? lastActive : fallbackId;
    if (targetId) {
        await selectChat(targetId);
    }
}

export function clearActiveRoom(): void {
    if (get(isMultiRoom)) {
        MultiRoomService.closeRoom();
    }
    isMultiRoom.set(false);
    activeRoomId.set(null);
    roomChats.clear();
    multiRoomCharacters.clear();
    multiRoomPersonas.clear();
    activeChatId.set(null);
    chatSelections.set(null);
    chatLorebooks.clear();
    messages.clear();
    messageIndexes.set(new Map());
    translations.clear();
}

export async function createRoom(fields: DeepPartial<RoomFields> = {}): Promise<Room> {
    const settings = await getAppSettings();
    const room = await RoomService.create(fields);
    const sortOrder = generateSortOrder(settings.rooms.refs, settings.rooms.folders);

    try {
        await updateSettings({
            rooms: { refs: { [room.id]: { id: room.id, sortOrder } } }
        });
    } catch (error) {
        await RoomService.delete(room.id);
        throw error;
    }

    rooms.set(room.id, room);
    return room;
}

export async function updateRoom(roomId: string, changes: DeepPartial<RoomFields>): Promise<void> {
    const updated = await RoomService.update(roomId, changes);
    if (multiRooms.get(roomId) || (get(isMultiRoom) && get(activeRoomId) === roomId)) {
        multiRooms.set(roomId, updated);
    } else {
        rooms.set(roomId, updated);
    }
}

export async function updateRoomContent(
    roomId: string,
    changes: DeepPartial<RoomContent>
): Promise<void> {
    const updated = await RoomService.update(roomId, changes);
    if (multiRooms.get(roomId) || (get(isMultiRoom) && get(activeRoomId) === roomId)) {
        multiRooms.set(roomId, updated);
    } else {
        rooms.set(roomId, updated);
    }
}

export async function deleteRoom(roomId: string): Promise<void> {
    if (multiRooms.get(roomId)) {
        throw new AppError('INVALID_INPUT', `Cannot delete multi room with deleteRoom: ${roomId}`);
    }

    const settings = await getAppSettings();
    const existingRef = settings.rooms.refs[roomId];
    await updateSettings({ rooms: { refs: { [roomId]: undefined } } });

    try {
        await RoomService.delete(roomId);
    } catch (error) {
        await updateSettings({ rooms: { refs: { [roomId]: existingRef } } });
        throw error;
    }

    rooms.delete(roomId);
    if (roomId === get(activeRoomId)) {
        clearActiveRoom();
    }
}

export async function addRoomCharacter(roomId: string, characterId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const character = await getCharacter(characterId);
    if (!character) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);

    const existing = room.characters.refs[characterId];
    const sortOrder =
        existing?.sortOrder ?? generateSortOrder(room.characters.refs, room.characters.folders);
    await updateRoom(roomId, {
        characters: {
            refs: {
                [characterId]: {
                    ...existing,
                    id: characterId,
                    sortOrder
                }
            }
        }
    });

    const activeId = get(activeChatId);
    if (activeId) {
        const activeC = get(activeChat);
        if (activeC?.roomId === roomId) {
            await resolveChatSelections(activeId);
        }
    }
}

export async function removeRoomCharacter(roomId: string, characterId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    await updateRoom(roomId, {
        characters: { refs: { [characterId]: undefined } }
    });

    const activeId = get(activeChatId);
    if (activeId) {
        const activeC = get(activeChat);
        if (activeC?.roomId === roomId) {
            await resolveChatSelections(activeId);
        }
    }
}

export type RoomFolderType = 'chats' | 'characters';

export async function createRoomFolder(
    roomId: string,
    folderType: RoomFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: sortOrder ?? generateSortOrder(room[folderType].refs, room[folderType].folders),
        parentId
    };

    await updateRoom(roomId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updateRoomFolder(
    roomId: string,
    folderType: RoomFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) return;

    const existing = room[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updateRoom(roomId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deleteRoomFolder(
    roomId: string,
    folderType: RoomFolderType,
    folderId: string
): Promise<void> {
    await updateRoom(roomId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function moveRoomItem(
    roomId: string,
    folderType: RoomFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) return;

    const existing = room[folderType].refs[itemId];
    if (!existing) return;

    await updateRoom(roomId, {
        [folderType]: {
            refs: {
                [itemId]: {
                    ...existing,
                    folderId: newFolderId,
                    sortOrder: newSortOrder ?? existing.sortOrder
                }
            }
        }
    });
}
