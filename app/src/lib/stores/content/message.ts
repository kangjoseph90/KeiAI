/**
 * Message Store — Chat-owned Message CRUD
 *
 * Internal state: messageMap (Map<id, Message>) — O(1) lookup by id.
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
	type ChatSummaryFields
} from '$lib/services';
import { messages, messageMap, chats, activeChat, activeChatId } from '../state';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';

// ─── Getter ────────────────────────────────────────────────────────────

/**
 * Returns a message from the active store (O(1) Map lookup) first,
 * then falls back to IDB if not cached.
 * Follows the same pattern as getModule(), getChatDetail(), etc.
 */
export async function getMessage(messageId: string): Promise<Message> {
	const cached = get(messageMap).get(messageId);
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
		messageMap.set(new Map(initialMsgs.map((m) => [m.id, m])));
	}
}

export async function loadOlderMessages(chatId: string, limit = 50): Promise<void> {
	const msgs = get(messages);
	if (msgs.length === 0) return;

	const oldestCursor = msgs[0].sortOrder;
	const olderMsgs = await MessageService.getMessagesBefore(chatId, oldestCursor, limit);

	// Store update — only if still viewing this chat
	if (olderMsgs.length > 0 && get(activeChatId) === chatId) {
		messageMap.update((map) => {
			const next = new Map(map);
			for (const msg of olderMsgs) next.set(msg.id, msg);
			return next;
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
		messageMap.update((map) => {
			const next = new Map(map);
			for (const msg of newerMsgs) next.set(msg.id, msg);
			return next;
		});
	}
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function createMessage(
	chatId: string,
	fields: DeepPartial<MessageFields> = {}
): Promise<void> {
	const activeSwipe = (fields.swipes ?? [])[fields.activeSwipeIndex ?? 0];
	const preview = activeSwipe?.content?.substring(0, 50) ?? '';

	// DB writes — always happen with explicit chatId
	const currentChat = get(activeChat);
	const newCount = (currentChat?.messageCount ?? 0) + 1;

	const [newMessage, updatedChat] = await Promise.all([
		MessageService.create(chatId, fields),
		ChatService.updateSummary(chatId, {
			lastMessagePreview: preview,
			messageCount: newCount
		})
	]);

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== chatId) return;
	messageMap.update((map) => {
		const next = new Map(map);
		next.set(newMessage.id, newMessage);
		return next;
	});
	chats.update((list) => list.map((c) => (c.id === chatId ? updatedChat : c)));
	activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
}

export async function updateMessage(
	msgId: string,
	changes: DeepPartial<MessageFields>
): Promise<void> {
	// DB write — always happens
	const updated = await MessageService.update(msgId, changes);

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== updated.chatId) return;

	messageMap.update((map) => {
		const next = new Map(map);
		next.set(msgId, updated);
		return next;
	});

	// Only update chat preview if the edited message is the last one
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;
	if (isLastMessage) {
		const activeSwipe = updated.swipes[updated.activeSwipeIndex];
		const preview = activeSwipe?.content?.substring(0, 50) ?? '';
		const updatedChat = await ChatService.updateSummary(updated.chatId, {
			lastMessagePreview: preview
		});
		chats.update((list) => list.map((c) => (c.id === updated.chatId ? updatedChat : c)));
		activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
	}
}

export async function deleteMessage(chatId: string, msgId: string): Promise<void> {
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;

	// DB write — always happens
	await MessageService.delete(msgId);

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== chatId) return;

	messageMap.update((map) => {
		const next = new Map(map);
		next.delete(msgId);
		return next;
	});

	const currentChat = get(activeChat);
	const newCount = Math.max(0, (currentChat?.messageCount ?? 1) - 1);
	const summaryChanges: DeepPartial<ChatSummaryFields> = { messageCount: newCount };

	if (isLastMessage) {
		const remainingMessages = get(messages);
		const lastMsg = remainingMessages[remainingMessages.length - 1];
		summaryChanges.lastMessagePreview = lastMsg
			? (lastMsg.swipes[lastMsg.activeSwipeIndex]?.content?.substring(0, 50) ?? '')
			: '';
	}

	const updatedChat = await ChatService.updateSummary(chatId, summaryChanges);
	chats.update((list) => list.map((c) => (c.id === chatId ? updatedChat : c)));
	activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
}
