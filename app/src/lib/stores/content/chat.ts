import { get } from 'svelte/store';
import {
    ChatService,
    LorebookService,
    type ChatFields,
    type ChatContent,
    type LorebookFields,
    type Lorebook,
    type Chat
} from '$lib/services';
import type { FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    roomChats,
    activeChat,
    messages,
    chatLorebooks,
    activeChatId,
    activeRoomId,
    messageIndexes
} from '../state';
import { loadInitialMessages } from './message';
import { getRoom, updateRoom } from './room';
import { getPersona } from './persona';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns chat from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getChat(chatId: string): Promise<Chat | null> {
    const active = get(activeChat);
    if (active?.id === chatId) return active;
    const cached = roomChats.get(chatId);
    if (cached) return cached;
    return ChatService.get(chatId);
}

/**
 * Returns lorebooks owned by a chat.
 * Uses store cache for the active chat, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getChatLorebooks(chatId: string): Promise<Lorebook[]> {
    if (chatId === get(activeChatId)) {
        return get(chatLorebooks);
    }
    const chat = await getChat(chatId);
    if (!chat) return [];
    const results = await Promise.all(
        Object.keys(chat.lorebooks.refs).map((id) => LorebookService.get(id))
    );
    return results.filter((lb): lb is Lorebook => lb !== null);
}

export async function selectChat(chatId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    clearActiveChat();
    roomChats.set(chat.id, chat);
    activeChatId.set(chat.id);
    await loadInitialMessages(chatId, 50);

    const personaIds = Object.keys(chat.personas.refs);
    const [lorebooks, personaEntries, room] = await Promise.all([
        LorebookService.listByOwner(chatId),
        Promise.all(personaIds.map(async (id) => [id, await getPersona(id)] as const)),
        getRoom(chat.roomId)
    ]);

    const stalePersonaRefs: Record<string, undefined> = {};
    for (const [id, persona] of personaEntries) {
        if (!persona) {
            stalePersonaRefs[id] = undefined;
        }
    }

    chatLorebooks.setAll(sortByRefs(lorebooks, chat.lorebooks.refs));

    const defaultPersonaRef = chat.defaultPersonaId
        ? chat.personas.refs[chat.defaultPersonaId]
        : undefined;
    const selectedPersonaRef = chat.selectedPersonaId
        ? chat.personas.refs[chat.selectedPersonaId]
        : undefined;
    const defaultCharacterRef =
        room && chat.defaultCharacterId ? room.characters.refs[chat.defaultCharacterId] : undefined;
    const selectedCharacterRef =
        room && chat.selectedCharacterId
            ? room.characters.refs[chat.selectedCharacterId]
            : undefined;
    const defaultPatch: DeepPartial<ChatFields> = {};
    if (
        chat.defaultPersonaId &&
        (!defaultPersonaRef ||
            defaultPersonaRef.enabled === false ||
            chat.defaultPersonaId in stalePersonaRefs)
    ) {
        defaultPatch.defaultPersonaId = undefined;
    }
    if (
        chat.defaultCharacterId &&
        (!defaultCharacterRef || defaultCharacterRef.enabled === false)
    ) {
        defaultPatch.defaultCharacterId = undefined;
    }
    if (
        chat.selectedPersonaId &&
        (!selectedPersonaRef ||
            selectedPersonaRef.enabled === false ||
            chat.selectedPersonaId in stalePersonaRefs)
    ) {
        defaultPatch.selectedPersonaId = undefined;
    }
    if (
        chat.selectedCharacterId &&
        (!selectedCharacterRef || selectedCharacterRef.enabled === false)
    ) {
        defaultPatch.selectedCharacterId = undefined;
    }

    if (Object.keys(stalePersonaRefs).length > 0 || Object.keys(defaultPatch).length > 0) {
        await updateChat(chatId, {
            personas: { refs: stalePersonaRefs },
            ...defaultPatch
        });
    }

    await updateRoom(chat.roomId, { lastActiveChatId: chatId });
}

export function clearActiveChat(): void {
    activeChatId.set(null);
    chatLorebooks.clear();
    messages.clear();
    messageIndexes.set(new Map());
}

export async function createChat(
    roomId: string,
    fields: DeepPartial<ChatFields> = {}
): Promise<Chat> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const chat = await ChatService.create(roomId, fields);

    const sortOrder = generateSortOrder(room.chats.refs);
    try {
        await updateRoom(roomId, {
            chats: { refs: { [chat.id]: { id: chat.id, sortOrder } } }
        });
    } catch (error) {
        await ChatService.delete(chat.id);
        throw error;
    }

    if (roomId === get(activeRoomId)) {
        roomChats.set(chat.id, chat);
    }

    return chat;
}

export async function updateChat(chatId: string, changes: DeepPartial<ChatFields>): Promise<void> {
    const updated = await ChatService.update(chatId, changes);
    roomChats.set(chatId, updated);
}

export async function setChatSelectedPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const ref = chat.personas.refs[personaId];
    if (!ref || ref.enabled === false) {
        throw new AppError('INVALID_INPUT', `Persona is not active in this chat: ${personaId}`);
    }
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    await updateChat(chatId, {
        selectedPersonaId: personaId
    });
}

export async function setChatDefaultPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const ref = chat.personas.refs[personaId];
    if (!ref || ref.enabled === false) {
        throw new AppError('INVALID_INPUT', `Persona is not active in this chat: ${personaId}`);
    }
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    await updateChat(chatId, { defaultPersonaId: personaId });
}

export async function setChatSelectedCharacter(chatId: string, characterId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const room = await getRoom(chat.roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);
    const ref = room.characters.refs[characterId];
    if (!ref || ref.enabled === false) {
        throw new AppError('INVALID_INPUT', `Character is not active in this room: ${characterId}`);
    }

    await updateChat(chatId, {
        selectedCharacterId: characterId
    });
}

export async function setChatDefaultCharacter(chatId: string, characterId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const room = await getRoom(chat.roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);
    const ref = room.characters.refs[characterId];
    if (!ref || ref.enabled === false) {
        throw new AppError('INVALID_INPUT', `Character is not active in this room: ${characterId}`);
    }

    await updateChat(chatId, { defaultCharacterId: characterId });
}

export async function updateChatContent(
    chatId: string,
    changes: DeepPartial<ChatContent>
): Promise<void> {
    const updated = await ChatService.update(chatId, changes);
    roomChats.set(chatId, updated);
}

export async function deleteChat(chatId: string, roomId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    // Capture ref for potential rollback
    const existingRef = room.chats.refs[chatId];

    // Remove from parent's refs
    await updateRoom(roomId, { chats: { refs: { [chatId]: undefined } } });

    try {
        await ChatService.delete(chatId);
    } catch (error) {
        await updateRoom(roomId, { chats: { refs: { [chatId]: existingRef } } });
        throw error;
    }

    if (roomId === get(activeRoomId)) {
        roomChats.delete(chatId);
    }

    if (chatId === get(activeChatId)) {
        clearActiveChat();
    }
}

// ─── Chat-owned Lorebook CRUD ─────────────────────────────────────

export async function createChatLorebook(
    chatId: string,
    fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const lb = await LorebookService.create(chatId, fields);

    const sortOrder = generateSortOrder(chat.lorebooks.refs);
    try {
        await updateChat(chatId, {
            lorebooks: { refs: { [lb.id]: { id: lb.id, sortOrder } } }
        });
    } catch (error) {
        await LorebookService.delete(lb.id);
        throw error;
    }

    if (chatId === get(activeChatId)) {
        chatLorebooks.set(lb.id, lb);
    }

    return lb;
}

export async function deleteChatLorebook(chatId: string, lorebookId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    // Capture ref for potential rollback
    const existingRef = chat.lorebooks.refs[lorebookId];

    // Remove from parent's refs
    await updateChat(chatId, { lorebooks: { refs: { [lorebookId]: undefined } } });

    try {
        await LorebookService.delete(lorebookId);
    } catch (error) {
        await updateChat(chatId, { lorebooks: { refs: { [lorebookId]: existingRef } } });
        throw error;
    }

    if (chatId === get(activeChatId)) {
        chatLorebooks.delete(lorebookId);
    }
}

export async function updateChatLorebook(
    chatId: string,
    lorebookId: string,
    changes: DeepPartial<LorebookFields>
): Promise<void> {
    const updated = await LorebookService.update(lorebookId, changes);
    if (chatId === get(activeChatId)) {
        chatLorebooks.set(lorebookId, updated);
    }
}

// ─── Chat Persona Ref CRUD ─────────────────────────────────────

export async function addChatPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    const existing = chat.personas.refs[personaId];
    const sortOrder = existing?.sortOrder ?? generateSortOrder(chat.personas.refs);
    await updateChat(chatId, {
        personas: {
            refs: {
                [personaId]: {
                    ...existing,
                    id: personaId,
                    sortOrder,
                    enabled: existing?.enabled ?? true
                }
            }
        }
    });
}

export async function removeChatPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    await updateChat(chatId, {
        personas: { refs: { [personaId]: undefined } },
        ...(chat.selectedPersonaId === personaId ? { selectedPersonaId: undefined } : {}),
        ...(chat.defaultPersonaId === personaId ? { defaultPersonaId: undefined } : {})
    });
}

export async function setChatPersonaEnabled(
    chatId: string,
    personaId: string,
    enabled: boolean
): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const existing = chat.personas.refs[personaId];
    if (!existing) return;

    await updateChat(chatId, {
        personas: {
            refs: {
                [personaId]: {
                    ...existing,
                    enabled
                }
            }
        },
        ...(chat.selectedPersonaId === personaId && !enabled
            ? { selectedPersonaId: undefined }
            : {}),
        ...(chat.defaultPersonaId === personaId && !enabled ? { defaultPersonaId: undefined } : {})
    });
}

// ─── Chat-owned Folder & Item Management ──────────────────────

export type ChatFolderType = 'lorebooks' | 'personas';

export async function createChatFolder(
    chatId: string,
    folderType: ChatFolderType,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(chat[folderType].folders),
        parentId
    };

    await updateChat(chatId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updateChatFolder(
    chatId: string,
    folderType: ChatFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) return;

    const existing = chat[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updateChat(chatId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deleteChatFolder(
    chatId: string,
    folderType: ChatFolderType,
    folderId: string
): Promise<void> {
    await updateChat(chatId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function moveChatItem(
    chatId: string,
    folderType: ChatFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) return;

    const existing = chat[folderType].refs[itemId];
    if (!existing) return;

    await updateChat(chatId, {
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
