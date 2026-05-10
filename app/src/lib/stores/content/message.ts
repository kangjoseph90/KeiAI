/**
 * Message Store — Chat-owned Message CRUD
 *
 * Internal state: messages (EntityStore<Message>) — O(1) lookup by id.
 * UI reads the `messages` derived store (sorted by sortOrder).
 *
 * Messages belong to a chat (1:N via chatId FK).
 * All functions take explicit chatId. DB writes always happen;
 * store (UI cache) updates are guarded by activeChatId check.
 */

import { get } from 'svelte/store';
import {
    MessageService,
    type MessageFields,
    type Message,
    type MessageSwipe,
    type MessageSwipeFields
} from '$lib/services';
import { messages, activeChatId, messageIndexes } from '../state';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';
import { getChat, updateChat } from './chat';

// ─── Getter ────────────────────────────────────────────────────────────

/**
 * Returns a message from the active store (O(1) lookup) first,
 * then falls back to IDB if not cached.
 * Follows the same pattern as getModule(), getChat(), etc.
 */
export async function getMessage(messageId: string): Promise<Message | null> {
    const cached = messages.get(messageId);
    if (cached) return cached;

    return MessageService.get(messageId);
}

/**
 * Returns a last message of a chat.
 * Returns null if chat is empty.
 * @param chatId
 * @returns
 */
export async function getLastMessage(chatId: string): Promise<Message | null> {
    const chat = await getChat(chatId);
    if (!chat) return null;

    if (chat.lastMessageId) {
        const message = await getMessage(chat.lastMessageId);
        if (message && message.chatId === chatId) return message;
    }

    const [message] = await MessageService.getMessagesBefore(chatId, '\uffff', 1);
    return message ?? null;
}

// ─── Load ──────────────────────────────────────────────────────────────

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadInitialMessages(chatId: string, limit = 50): Promise<void> {
    const initialMsgs = await MessageService.getMessagesBefore(chatId, '\uffff', limit);
    if (get(activeChatId) === chatId) {
        messages.setAll(initialMsgs);
        await refreshIndexes(chatId);
    }
}

export async function loadOlderMessages(chatId: string, limit = 50): Promise<void> {
    const msgs = get(messages);
    if (msgs.length === 0) return;

    const oldestCursor = msgs[0].sortOrder;
    const olderMsgs = await MessageService.getMessagesBefore(chatId, oldestCursor, limit);

    // Store update — only if still viewing this chat
    if (olderMsgs.length > 0 && get(activeChatId) === chatId) {
        messages.batch(() => {
            for (const msg of olderMsgs) messages.set(msg.id, msg);
        });
        await refreshIndexes(chatId);
    }
}

export async function loadNewerMessages(chatId: string, limit = 50): Promise<void> {
    const msgs = get(messages);
    if (msgs.length === 0) return;

    const newestCursor = msgs[msgs.length - 1].sortOrder;
    const newerMsgs = await MessageService.getMessagesAfter(chatId, newestCursor, limit);

    // Store update — only if still viewing this chat
    if (newerMsgs.length > 0 && get(activeChatId) === chatId) {
        messages.batch(() => {
            for (const msg of newerMsgs) messages.set(msg.id, msg);
        });
        await refreshIndexes(chatId);
    }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function createMessage(
    chatId: string,
    fields: DeepPartial<MessageFields> = {}
): Promise<Message> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    let prevSortOrder: string | undefined = undefined;
    if (chat.lastMessageId) {
        const lastMessage = await getMessage(chat.lastMessageId);
        if (lastMessage) prevSortOrder = lastMessage.sortOrder;
    }

    const newMessage = await MessageService.create(chatId, fields, prevSortOrder);
    await updateChat(chatId, { lastMessageId: newMessage.id });

    // Store update — only if still viewing this chat
    if (get(activeChatId) === chatId) {
        messages.set(newMessage.id, newMessage);
        await refreshIndexes(chatId);
    }

    return newMessage;
}

export async function updateMessage(
    msgId: string,
    changes: DeepPartial<MessageFields>
): Promise<void> {
    // DB write — always happens
    const updated = await MessageService.update(msgId, changes);

    // Store update — only if still viewing this chat
    if (get(activeChatId) !== updated.chatId) return;

    messages.set(msgId, updated);
}

export async function deleteMessage(chatId: string, msgId: string): Promise<void> {
    // DB write — always happens
    await MessageService.delete(msgId);
    const chat = await getChat(chatId);
    if (chat?.lastMessageId === msgId) {
        const [lastMessage] = await MessageService.getMessagesBefore(chatId, '\uffff', 1);
        await updateChat(chatId, { lastMessageId: lastMessage?.id });
    }

    // Store update — only if still viewing this chat
    if (get(activeChatId) !== chatId) return;

    messages.delete(msgId);
    await refreshIndexes(chatId);
}

export async function createMessageSwipe(
    messageId: string,
    fields: MessageSwipeFields
): Promise<{ swipeId: string; message: Message }> {
    const { swipeId, message: updated } = await MessageService.createSwipe(messageId, fields);

    if (get(activeChatId) === updated.chatId) {
        messages.set(messageId, updated);
    }
    return { swipeId, message: updated };
}

export async function updateMessageSwipe(
    messageId: string,
    swipeId: string,
    changes: DeepPartial<MessageSwipe>
): Promise<Message> {
    const updated = await MessageService.updateSwipe(messageId, swipeId, changes);

    if (get(activeChatId) === updated.chatId) {
        messages.set(messageId, updated);
    }
    return updated;
}

export async function deleteMessageSwipe(messageId: string, swipeId: string): Promise<Message> {
    const updated = await MessageService.deleteSwipe(messageId, swipeId);

    if (get(activeChatId) === updated.chatId) {
        messages.set(messageId, updated);
    }
    return updated;
}

export async function prepareNextSwipe(
    message: Message,
    fields: MessageSwipeFields,
    replaceActiveSwipe: boolean = false
): Promise<{ swipeId: string; message: Message }> {
    let current = message;

    if (replaceActiveSwipe && current.activeSwipeId && current.swipes[current.activeSwipeId]) {
        current = await deleteMessageSwipe(current.id, current.activeSwipeId);
    }

    const created = await createMessageSwipe(current.id, fields);
    const updated = await MessageService.update(current.id, { activeSwipeId: created.swipeId });

    if (get(activeChatId) === updated.chatId) {
        messages.set(current.id, updated);
    }

    return {
        swipeId: created.swipeId,
        message: updated
    };
}

// ─── Internal Helpers ──────────────────────────────────────────────────

/**
 * Re-calculates global indexes for all currently loaded messages.
 * Uses countByChatBefore to find the offset of the first message.
 */
async function refreshIndexes(chatId: string) {
    if (get(activeChatId) !== chatId) return;

    const msgs = get(messages);
    if (msgs.length === 0) {
        messageIndexes.set(new Map());
        return;
    }

    // DB count of messages before the first one in our window
    const offset = await MessageService.countByChatBefore(chatId, msgs[0].sortOrder);

    const newMap = new Map<string, number>();
    msgs.forEach((msg, i) => {
        newMap.set(msg.id, offset + i);
    });

    messageIndexes.set(newMap);
}
