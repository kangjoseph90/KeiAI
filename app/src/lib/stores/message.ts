/**
 * Message Store — Chat-owned Message CRUD
 *
 * Messages belong to a chat (1:N via chatId FK).
 * All functions take explicit chatId. DB writes always happen;
 * store (UI cache) updates are guarded by activeChatId check.
 */

import { get } from 'svelte/store';
import { MessageService, type MessageFields } from '../services/message.js';
import { ChatService } from '../services/chat.js';
import { messages, chats, activeChat, activeChatId } from './state.js';

export async function loadInitialMessages(chatId: string, limit = 50) {
	const initialMsgs = await MessageService.getMessagesBefore(chatId, '\uffff', limit);
	if (get(activeChatId) === chatId) {
		messages.set(initialMsgs);
	}
}

export async function loadOlderMessages(chatId: string, limit = 50) {
	const msgs = get(messages);
	if (msgs.length === 0) return;

	const oldestCursor = msgs[0].sortOrder;
	const olderMsgs = await MessageService.getMessagesBefore(chatId, oldestCursor, limit);

	// Store update — only if still viewing this chat
	if (olderMsgs.length > 0 && get(activeChatId) === chatId) {
		messages.update((list) => [...olderMsgs, ...list]);
	}
}

export async function loadNewerMessages(chatId: string, limit = 50) {
	const msgs = get(messages);
	if (msgs.length === 0) return;

	const newestCursor = msgs[msgs.length - 1].sortOrder;
	const newerMsgs = await MessageService.getMessagesAfter(chatId, newestCursor, limit);

	// Store update — only if still viewing this chat
	if (newerMsgs.length > 0 && get(activeChatId) === chatId) {
		messages.update((list) => [...list, ...newerMsgs]);
	}
}

export async function createMessage(chatId: string, fields: MessageFields) {
	const preview = fields.content.substring(0, 50);

	// DB writes — always happen with explicit chatId
	const [newMessage, updatedChat] = await Promise.all([
		MessageService.create(chatId, fields),
		ChatService.updateSummary(chatId, { lastMessagePreview: preview })
	]);

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== chatId) return;

	messages.update((prev) => [...prev, newMessage]);
	if (updatedChat) {
		chats.update((list) => list.map((c) => (c.id === chatId ? updatedChat : c)));
		activeChat.update((c) => (c && c.id === chatId ? { ...c, ...updatedChat } : c));
	}
}

export async function updateMessage(msgId: string, changes: Partial<MessageFields>) {
	// DB write — always happens
	const currentChatId = get(activeChatId);
	const updated = await MessageService.update(msgId, changes, currentChatId ?? undefined);
	if (!updated) return;

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== updated.chatId) return;

	messages.update((list) => list.map((m) => (m.id === msgId ? updated : m)));

	// Only update chat preview if the edited message is the last one
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;
	if (isLastMessage) {
		const preview = updated.content.substring(0, 50);
		const updatedChat = await ChatService.updateSummary(updated.chatId, {
			lastMessagePreview: preview
		});
		if (updatedChat && get(activeChatId) === updated.chatId) {
			chats.update((list) => list.map((c) => (c.id === updated.chatId ? updatedChat : c)));
			activeChat.update((c) => (c && c.id === updated.chatId ? { ...c, ...updatedChat } : c));
		}
	}
}

export async function deleteMessage(chatId: string, msgId: string) {
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;

	// DB write — always happens
	await MessageService.delete(msgId, chatId);

	// Store update — only if still viewing this chat
	if (get(activeChatId) !== chatId) return;

	messages.update((list) => list.filter((m) => m.id !== msgId));

	if (isLastMessage) {
		const remainingMessages = get(messages);
		const preview =
			remainingMessages.length > 0
				? remainingMessages[remainingMessages.length - 1].content.substring(0, 50)
				: '';
		const updatedChat = await ChatService.updateSummary(chatId, { lastMessagePreview: preview });
		if (updatedChat && get(activeChatId) === chatId) {
			chats.update((list) => list.map((c) => (c.id === chatId ? updatedChat : c)));
			activeChat.update((c) => (c && c.id === chatId ? { ...c, ...updatedChat } : c));
		}
	}
}
