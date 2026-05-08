import { get } from 'svelte/store';
import {
    ChatService,
    MessageService,
    LorebookService,
    type ChatFields,
    type ChatContent,
    type LorebookFields,
    type Lorebook,
    type Chat,
    type MessageSwipe,
    type Greeting
} from '$lib/services';
import type { FolderDef, EntityListConfig } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    chats,
    activeChat,
    messages,
    chatLorebooks,
    activeCharacterId,
    activeChatId
} from '../state';
import { loadInitialMessages } from './message';
import { getCharacter, updateCharacter } from './character';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns chat from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getChat(chatId: string): Promise<Chat> {
    const active = get(activeChat);
    if (active?.id === chatId) return active;
    const cached = chats.get(chatId);
    if (cached) return cached;
    const db = await ChatService.get(chatId);
    if (!db) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    return db;
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
    const refs = chat.lorebooks?.refs;
    if (!refs) return [];
    const results = await Promise.all(Object.keys(refs).map((id) => LorebookService.get(id)));
    return results.filter((lb): lb is Lorebook => lb !== null);
}

export async function selectChat(chatId: string, characterId: string): Promise<void> {
    const chat = await getChat(chatId);

    clearActiveChat();
    activeChat.set(chat);
    await loadInitialMessages(chatId, 50);

    const lorebooks = await LorebookService.listByOwner(chatId);
    chatLorebooks.setAll(sortByRefs(lorebooks, chat.lorebooks?.refs ?? {}));

    await updateCharacter(characterId, { lastActiveChatId: chatId });
}

export function clearActiveChat(): void {
    activeChat.set(null);
    chatLorebooks.clear();
    messages.clear();
}

export async function createChat(
    characterId: string,
    fields: DeepPartial<ChatFields> = {}
): Promise<Chat> {
    const char = await getCharacter(characterId);

    const chat = await ChatService.create(characterId, fields);

    const refs = char.chats?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
    try {
        await updateCharacter(characterId, {
            chats: { refs: { [chat.id]: { id: chat.id, sortOrder } } }
        });
    } catch (error) {
        await ChatService.delete(chat.id);
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        chats.set(chat.id, chat);
    }

    return chat;
}

export async function updateChat(chatId: string, changes: DeepPartial<ChatFields>): Promise<void> {
    const updated = await ChatService.update(chatId, changes);
    chats.set(chatId, updated);
    if (chatId === get(activeChatId)) {
        activeChat.set(updated);
    }
}

export async function updateChatContent(
    chatId: string,
    changes: DeepPartial<ChatContent>
): Promise<void> {
    const updated = await ChatService.update(chatId, changes);
    chats.set(chatId, updated);
    if (chatId === get(activeChatId)) {
        activeChat.set(updated);
    }
}

export async function deleteChat(chatId: string, characterId: string): Promise<void> {
    const char = await getCharacter(characterId);

    // Capture ref for potential rollback
    const existingRef = char.chats?.refs?.[chatId];

    // Remove from parent's refs
    await updateCharacter(characterId, { chats: { refs: { [chatId]: undefined } } });

    try {
        await ChatService.delete(chatId);
    } catch (error) {
        await updateCharacter(characterId, { chats: { refs: { [chatId]: existingRef } } });
        throw error;
    }

    if (characterId === get(activeCharacterId)) {
        chats.delete(chatId);
    }

    if (chatId === get(activeChatId)) {
        clearActiveChat();
    }
}

// ─── Fork ──────────────────────────────────────────────────────────

/**
 * Forks a chat at a specific message, copying all history up to that point
 * into a new thread. Includes chat-specific lorebooks.
 */
export async function forkChat(messageId: string): Promise<string> {
    const forkMessage = await MessageService.get(messageId);
    if (!forkMessage) {
        throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
    }
    const chatId = forkMessage.chatId;

    const beforeMessages = await MessageService.getMessagesBefore(
        chatId,
        forkMessage.sortOrder,
        Number.MAX_SAFE_INTEGER
    );
    const allMessages = [...beforeMessages, forkMessage];

    const originalChat = await getChat(chatId);
    const characterId = originalChat.characterId;

    const {
        id: _id,
        characterId: _charId,
        lorebooks: _,
        lastMessageId: _lastMessageId,
        greetingMessageId: _greetingMessageId,
        ...fieldsCopy
    } = originalChat;

    const newChat = await createChat(characterId, {
        ...fieldsCopy,
        title: `${originalChat.title} (Fork)`
    });

    const createdMessages = await Promise.all(
        allMessages.map((msg) =>
            MessageService.create(
                newChat.id,
                {
                    role: msg.role,
                    swipes: msg.swipes,
                    activeSwipeId: msg.activeSwipeId
                },
                msg.sortOrder
            )
        )
    );

    const lastCopiedMessage = createdMessages[createdMessages.length - 1];
    if (lastCopiedMessage) {
        await updateChat(newChat.id, { lastMessageId: lastCopiedMessage.id });
    }

    const lorebooks = await LorebookService.listByOwner(chatId);
    const copiedLorebooks = await Promise.all(
        lorebooks.map(async (lb) => {
            const { id: _lbId, ownerId: _ownerId, ...fields } = lb;
            return LorebookService.create(newChat.id, fields);
        })
    );

    const lorebookRefs: Record<string, { id: string; sortOrder: string }> = {};
    for (const copiedLb of copiedLorebooks) {
        const sortOrder = generateSortOrder(lorebookRefs);
        lorebookRefs[copiedLb.id] = { id: copiedLb.id, sortOrder };
    }

    if (Object.keys(lorebookRefs).length > 0) {
        await updateChat(newChat.id, { lorebooks: { refs: lorebookRefs } });
    }

    // Character's chat refs are already updated by createChat() calling updateCharacter()

    if (characterId === get(activeCharacterId)) {
        chats.set(newChat.id, newChat);
    }

    return newChat.id;
}

// ─── Chat-owned Lorebook CRUD ─────────────────────────────────────

export async function createChatLorebook(
    chatId: string,
    fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
    const chat = await getChat(chatId);

    const lb = await LorebookService.create(chatId, fields);

    const refs = chat.lorebooks?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
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

    // Capture ref for potential rollback
    const existingRef = chat.lorebooks?.refs?.[lorebookId];

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

// ─── Chat-owned Folder & Item Management ──────────────────────

export type ChatFolderType = 'lorebooks';

export async function createChatFolder(
    chatId: string,
    folderType: ChatFolderType,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const chat = await getChat(chatId);

    const config = chat[folderType] as EntityListConfig | undefined;
    const existingFolders = config?.folders ?? {};

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(existingFolders),
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

    const config = chat[folderType] as EntityListConfig | undefined;
    const existingFolders = config?.folders ?? {};
    const existing = existingFolders[folderId];
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

    const config = chat[folderType] as EntityListConfig | undefined;
    const refs = config?.refs ?? {};
    const existing = refs[itemId];
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
