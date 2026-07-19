import { get } from 'svelte/store';
import {
    ChatService,
    type ChatFields,
    type ChatContent,
    type Lorebook,
    type Chat,
    type FileItem
} from '$lib/services';
import type { AssetRef, FolderDef } from '$lib/types/refs';
import { compareSortOrder, generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    roomChats,
    activeChat,
    messages,
    activeChatId,
    activeRoomId,
    chatSelections,
    messageIndexes,
    roomCharacters,
    chatPersonas
} from '../state';
import { loadInitialMessages, repairChatMessageRefs } from './message';
import { getRoom, updateRoom } from './room';
import { getPersona } from './persona';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';
import type { AssetFields } from '$lib/types/asset';
import { createCache } from '$lib/adapters/cache';

/**
 * Cache for chat selections
 * Chat selection is stored separately from the chat record to support multi-room scenarios
 */
const chatSelectionCache = createCache<{ characterId?: string; personaId?: string }>(
    'chat-sel',
    100
);

let chatSelectionVersion = 0;

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

export async function getChatLorebooks(chatId: string): Promise<Lorebook[]> {
    const chat = await getChat(chatId);
    if (!chat) return [];
    return sortByRefs(Object.values(chat.lorebooks.refs), chat.lorebooks.refs);
}

/**
 * Resolves the active chat's selections (default character and persona).
 * Ensures that the default and selected characters/personas are valid
 */
export async function resolveChatSelections(chatId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) return;

    const room = await getRoom(chat.roomId);
    if (!room) return;

    // 1. Get the first attached character/persona IDs
    const charRefs = Object.values(room.characters.refs);
    const sortedChars = [...charRefs].sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));
    const firstCharacterId = sortedChars[0]?.id;

    const personaRefs = Object.values(chat.personas.refs);
    const sortedPersonas = [...personaRefs].sort((a, b) =>
        compareSortOrder(a.sortOrder, b.sortOrder)
    );
    const firstPersonaId = sortedPersonas[0]?.id;

    // 2. Validate/Update Defaults
    const patch: DeepPartial<ChatFields> = {};

    const defaultCharRef = chat.defaultCharacterId
        ? room.characters.refs[chat.defaultCharacterId]
        : undefined;
    if (!defaultCharRef) {
        if (chat.defaultCharacterId !== firstCharacterId) {
            patch.defaultCharacterId = firstCharacterId;
        }
    }

    const defaultPersonaRef = chat.defaultPersonaId
        ? chat.personas.refs[chat.defaultPersonaId]
        : undefined;
    if (!defaultPersonaRef) {
        if (chat.defaultPersonaId !== firstPersonaId) {
            patch.defaultPersonaId = firstPersonaId;
        }
    }

    if (Object.keys(patch).length > 0) {
        await updateChat(chatId, patch);
    }

    // 3. Resolve Selection (if active)
    if (chatId === get(activeChatId)) {
        const currentChat = get(activeChat) ?? chat; // Get potentially updated chat
        const cached = chatSelectionCache.get(chatId);
        const currentSel = get(chatSelections);

        const selCharId = currentSel?.characterId ?? cached?.characterId;
        const selPersonaId = currentSel?.personaId ?? cached?.personaId;

        const charRef = selCharId ? room.characters.refs[selCharId] : undefined;
        const personaRef = selPersonaId ? currentChat.personas.refs[selPersonaId] : undefined;

        const isCharValid = charRef !== undefined;
        const isPersonaValid = personaRef !== undefined;

        const finalCharId = isCharValid ? selCharId : currentChat.defaultCharacterId;
        const finalPersonaId = isPersonaValid ? selPersonaId : currentChat.defaultPersonaId;

        if (finalCharId !== currentSel?.characterId || finalPersonaId !== currentSel?.personaId) {
            const newSelection = { characterId: finalCharId, personaId: finalPersonaId };
            chatSelections.set(newSelection);
            chatSelectionCache.set(chatId, newSelection);
        }
    }
}

export async function selectChat(
    chatId: string,
    isContextCurrent: () => boolean = () => true
): Promise<void> {
    if (!isContextCurrent() || get(activeChatId) === chatId) return;

    const version = ++chatSelectionVersion;
    clearChatViewState();
    const isCurrent = () => version === chatSelectionVersion && isContextCurrent();

    const chat = await getChat(chatId);
    if (!isCurrent()) return;
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    roomChats.set(chat.id, chat);
    activeChatId.set(chat.id);
    await loadInitialMessages(chatId, 30, isCurrent);
    if (!isCurrent()) return;
    await repairChatMessageRefs(chatId);
    if (!isCurrent()) return;

    const personaIds = Object.keys(chat.personas.refs);
    const personaEntries = await Promise.all(
        personaIds.map(async (id) => [id, await getPersona(id)] as const)
    );
    if (!isCurrent()) return;

    const stalePersonaRefs: Record<string, undefined> = {};
    for (const [id, persona] of personaEntries) {
        if (!persona) {
            stalePersonaRefs[id] = undefined;
        }
    }

    if (Object.keys(stalePersonaRefs).length > 0) {
        await updateChat(chatId, {
            personas: { refs: stalePersonaRefs }
        });
        if (!isCurrent()) return;
    }

    await resolveChatSelections(chatId);
    if (!isCurrent()) return;

    await updateRoom(chat.roomId, { lastActiveChatId: chatId });
}

export function clearActiveChat(): void {
    chatSelectionVersion += 1;
    clearChatViewState();
}

function clearChatViewState(): void {
    activeChatId.set(null);
    chatSelections.set(null);
    messages.clear();
    messageIndexes.set(new Map());
}

export async function createChat(
    roomId: string,
    fields: DeepPartial<ChatFields> = {}
): Promise<Chat> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const chat = await ChatService.create(roomId, fields, room.scopeType);

    const sortOrder = generateSortOrder(room.chats.refs, room.chats.folders);
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

/** Returns the room's first chat, creating one if the room is empty. */
export async function ensureRoomHasChat(roomId: string): Promise<Chat> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);

    const existingIds = Object.keys(room.chats.refs);
    if (existingIds.length > 0) {
        const cached = roomChats.get(existingIds[0]);
        if (cached) return cached;
        const first = await ChatService.get(existingIds[0]);
        if (first) return first;
    }

    return createChat(roomId);
}

export async function updateChat(chatId: string, changes: DeepPartial<ChatFields>): Promise<void> {
    const updated = await ChatService.update(chatId, changes);
    roomChats.set(chatId, updated);
}

export function setChatSelectedPersona(chatId: string, personaId: string): void {
    if (get(activeChatId) !== chatId) return;
    chatSelections.update((current) => ({ ...current, personaId }));
    const selection = get(chatSelections);
    if (selection) chatSelectionCache.set(chatId, selection);
}

export function setChatSelectedCharacter(chatId: string, characterId: string): void {
    if (get(activeChatId) !== chatId) return;
    chatSelections.update((current) => ({ ...current, characterId }));
    const selection = get(chatSelections);
    if (selection) chatSelectionCache.set(chatId, selection);
}

export async function setChatDefaultPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const ref = chat.personas.refs[personaId];
    if (!ref) {
        throw new AppError('INVALID_INPUT', `Persona is not active in this chat: ${personaId}`);
    }
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    await updateChat(chatId, { defaultPersonaId: personaId });
}

export async function setChatDefaultCharacter(chatId: string, characterId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const room = await getRoom(chat.roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);
    const ref = room.characters.refs[characterId];
    if (!ref) {
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

    if (Object.keys(room.chats.refs).length <= 1) {
        throw new AppError('DELETE_LAST_ITEM', 'Cannot delete the last chat.');
    }

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

    chatSelectionCache.delete(chatId);

    if (room.lastActiveChatId === chatId) {
        const remainingIds = Object.keys(room.chats.refs).filter((id) => id !== chatId);
        await updateRoom(roomId, {
            lastActiveChatId: remainingIds.length > 0 ? remainingIds[0] : undefined
        });
    }

    if (roomId === get(activeRoomId)) {
        roomChats.delete(chatId);
    }

    if (chatId === get(activeChatId)) {
        clearActiveChat();
    }
}

// ─── Chat-owned resources ────────────────────────────────────────────

export async function saveChatLorebook(chatId: string, item: Lorebook): Promise<void> {
    await updateChat(chatId, { lorebooks: { refs: { [item.id]: item } } });
}

export async function deleteChatLorebook(chatId: string, lorebookId: string): Promise<void> {
    await updateChat(chatId, { lorebooks: { refs: { [lorebookId]: undefined } } });
}

export async function saveChatFile(chatId: string, item: FileItem): Promise<void> {
    await updateChat(chatId, { files: { refs: { [item.id]: item } } });
}

export async function deleteChatFile(chatId: string, fileId: string): Promise<void> {
    await updateChat(chatId, { files: { refs: { [fileId]: undefined } } });
}

// ─── Chat Persona Ref CRUD ─────────────────────────────────────

export async function addChatPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    const existing = chat.personas.refs[personaId];
    const sortOrder =
        existing?.sortOrder ?? generateSortOrder(chat.personas.refs, chat.personas.folders);
    await updateChat(chatId, {
        personas: {
            refs: {
                [personaId]: {
                    ...existing,
                    id: personaId,
                    sortOrder
                }
            }
        }
    });

    await resolveChatSelections(chatId);
}

export async function removeChatPersona(chatId: string, personaId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    await updateChat(chatId, {
        personas: { refs: { [personaId]: undefined } }
    });

    await resolveChatSelections(chatId);
}

// ─── Chat-owned Inlay CRUD ─────────────────────────────────────────

export async function createChatInlay(
    chatId: string,
    asset: File | AssetFields
): Promise<AssetRef> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const sortOrder = generateSortOrder(chat.inlays.refs, chat.inlays.folders);
    const { chat: updated, ref } = await ChatService.createInlay(chatId, asset, sortOrder);
    roomChats.set(chatId, updated);
    return ref;
}

export async function deleteChatInlay(chatId: string, assetId: string): Promise<void> {
    const updated = await ChatService.deleteInlay(chatId, assetId);
    roomChats.set(chatId, updated);
}

// ─── Chat-owned Folder & Item Management ──────────────────────

export type ChatFolderType = 'lorebooks' | 'personas' | 'inlays' | 'files';

export async function createChatFolder(
    chatId: string,
    folderType: ChatFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: sortOrder ?? generateSortOrder(chat[folderType].refs, chat[folderType].folders),
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
