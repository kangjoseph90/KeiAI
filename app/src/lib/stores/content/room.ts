import { get } from 'svelte/store';
import {
    RoomService,
    ChatService,
    type Room,
    type RoomFields,
    type RoomContent,
    type Character
} from '$lib/services';
import type { ResourceRef, FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { getCharacter } from './character';
import {
    rooms,
    activeRoom,
    activeRoomId,
    roomCharacters,
    chats,
    activeChat,
    chatLorebooks,
    chatPersonas,
    messages,
    messageIndexes
} from '../state';

export async function getRoom(roomId: string): Promise<Room | null> {
    const active = get(activeRoom);
    if (active?.id === roomId) return active;
    const cached = rooms.get(roomId);
    if (cached) return cached;
    return RoomService.get(roomId);
}

export async function loadRooms(): Promise<void> {
    rooms.setAll(await RoomService.list());
}

export async function selectRoom(roomId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    clearActiveRoom();
    activeRoom.set(room);

    const characterIds = Object.keys(room.characters.refs);
    const [chatList, characterEntries] = await Promise.all([
        ChatService.listByRoom(roomId),
        Promise.all(characterIds.map(async (id) => [id, await getCharacter(id)] as const))
    ]);

    const staleCharacterRefs: Record<string, undefined> = {};
    const characterList: Character[] = [];
    for (const [id, character] of characterEntries) {
        if (character) {
            characterList.push(character);
        } else {
            staleCharacterRefs[id] = undefined;
        }
    }

    const staleChatRefs: Record<string, undefined> = {};
    const actualChatIds = new Set(chatList.map((chat) => chat.id));
    for (const id of Object.keys(room.chats.refs)) {
        if (!actualChatIds.has(id)) {
            staleChatRefs[id] = undefined;
        }
    }

    chats.setAll(sortByRefs(chatList, room.chats.refs));
    roomCharacters.setAll(sortByRefs(characterList, room.characters.refs));

    if (Object.keys(staleCharacterRefs).length > 0 || Object.keys(staleChatRefs).length > 0) {
        await updateRoom(roomId, {
            characters: { refs: staleCharacterRefs },
            chats: { refs: staleChatRefs }
        });
    }
}

export function clearActiveRoom(): void {
    activeRoom.set(null);
    roomCharacters.clear();
    chats.clear();
    activeChat.set(null);
    chatLorebooks.clear();
    chatPersonas.clear();
    messages.clear();
    messageIndexes.set(new Map());
}

export async function createRoom(fields: DeepPartial<RoomFields> = {}): Promise<Room> {
    const room = await RoomService.create(fields);
    rooms.set(room.id, room);
    return room;
}

export async function updateRoom(roomId: string, changes: DeepPartial<RoomFields>): Promise<void> {
    const updated = await RoomService.update(roomId, changes);
    rooms.set(roomId, updated);
    if (roomId === get(activeRoomId)) {
        activeRoom.set(updated);
    }
}

export async function updateRoomContent(
    roomId: string,
    changes: DeepPartial<RoomContent>
): Promise<void> {
    const updated = await RoomService.updateContent(roomId, changes);
    rooms.set(roomId, updated);
    if (roomId === get(activeRoomId)) {
        activeRoom.set(updated);
    }
}

export async function deleteRoom(roomId: string): Promise<void> {
    await RoomService.delete(roomId);
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
    const sortOrder = existing?.sortOrder ?? generateSortOrder(room.characters.refs);
    await updateRoom(roomId, {
        characters: {
            refs: {
                [characterId]: {
                    ...existing,
                    id: characterId,
                    sortOrder,
                    enabled: existing?.enabled ?? true
                }
            }
        }
    });

    if (roomId === get(activeRoomId)) {
        roomCharacters.set(characterId, character);
    }
}

export async function removeRoomCharacter(roomId: string, characterId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    await updateRoom(roomId, {
        characters: { refs: { [characterId]: undefined } }
    });

    if (roomId === get(activeRoomId)) {
        roomCharacters.delete(characterId);
    }

    const chat = get(activeChat);
    if (chat?.roomId === roomId && chat.selectedCharacterId === characterId) {
        await import('./chat').then(({ updateChat }) =>
            updateChat(chat.id, {
                selectedCharacterId: undefined,
                ...(chat.defaultCharacterId === characterId
                    ? { defaultCharacterId: undefined }
                    : {})
            })
        );
    }
}

export async function setRoomCharacterEnabled(
    roomId: string,
    characterId: string,
    enabled: boolean
): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const existing = room.characters.refs[characterId];
    if (!existing) return;

    await updateRoom(roomId, {
        characters: {
            refs: {
                [characterId]: {
                    ...existing,
                    enabled
                }
            }
        }
    });

    const chat = get(activeChat);
    if (chat?.roomId === roomId && chat.selectedCharacterId === characterId && !enabled) {
        await import('./chat').then(({ updateChat }) =>
            updateChat(chat.id, {
                selectedCharacterId: undefined,
                ...(chat.defaultCharacterId === characterId
                    ? { defaultCharacterId: undefined }
                    : {})
            })
        );
    }
}

export type RoomFolderType = 'chats' | 'characters';

export async function createRoomFolder(
    roomId: string,
    folderType: RoomFolderType,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(room[folderType].folders),
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
