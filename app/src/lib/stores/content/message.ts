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
	ChatService,
	type MessageFields,
	type Message,
	type ChatFields
} from '$lib/services';
import { messages, chats, activeChat, activeChatId } from '../state';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';

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
	// 1. Create the message first to get its ID
	const newMessage = await MessageService.create(chatId, fields);

	// 2. Update chat with new count and lastMessageId
	const currentChat = get(activeChat);
	const newCount = (currentChat?.messageCount ?? 0) + 1;

	const updatedChat = await ChatService.update(chatId, {
		messageCount: newCount,
		lastMessageId: newMessage.id
	});

	// Store update — only if still viewing this chat
	if (get(activeChatId) === chatId) {
		messages.set(newMessage.id, newMessage);
		chats.set(chatId, updatedChat);
		activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
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

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== chatId) return;

	messages.delete(msgId);

	const currentChat = get(activeChat);
	const newCount = Math.max(0, (currentChat?.messageCount ?? 1) - 1);
	const chatChanges: DeepPartial<ChatFields> = { messageCount: newCount };

	// If the deleted message was the last one, we need to find the new last message
	if (currentChat?.lastMessageId === msgId) {
		const prevLastMsg = await MessageService.getMessagesBefore(chatId, '\uffff', 1);
		chatChanges.lastMessageId = prevLastMsg[0]?.id || undefined;
	}

	const updatedChat = await ChatService.update(chatId, chatChanges);
	chats.set(chatId, updatedChat);
	activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
}
