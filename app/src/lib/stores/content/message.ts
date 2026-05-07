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
import { messages, activeChatId } from '../state';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';
import { getChat, updateChat } from './chat';

// ─── Getter ────────────────────────────────────────────────────────────

/**
 * Returns a message from the active store (O(1) lookup) first,
 * then falls back to IDB if not cached.
 * Follows the same pattern as getModule(), getChat(), etc.
 */
export async function getMessage(messageId: string): Promise<Message> {
    const cached = messages.get(messageId);
    if (cached) return cached;

    const db = await MessageService.get(messageId);
    if (!db) throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
    return db;
}

/**
 * Returns a last message of a chat.
 * Returns null if chat is empty.
 * @param chatId
 * @returns
 */
export async function getLastMessage(chatId: string): Promise<Message | null> {
    // should throw if chat not found
    const chat = await getChat(chatId);

    if (chat.lastMessageId) {
        try {
            const message = await getMessage(chat.lastMessageId);
            if (message.chatId === chatId) return message;
        } catch {
            // Stale lastMessageId; fall back to index lookup.
        }
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
    }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function createMessage(
    chatId: string,
    fields: DeepPartial<MessageFields> = {}
): Promise<Message> {
    const chat = await getChat(chatId);

    let prevSortOrder: string | undefined = undefined;
    if (chat.lastMessageId) {
        const lastMessage = await getMessage(chat.lastMessageId);
        prevSortOrder = lastMessage.sortOrder;
    }

    const newMessage = await MessageService.create(chatId, fields, prevSortOrder);
    await updateChat(chatId, { lastMessageId: newMessage.id });

    // Store update — only if still viewing this chat
    if (get(activeChatId) === chatId) {
        messages.set(newMessage.id, newMessage);
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
