import { get } from 'svelte/store';
import { ChatService, type Chat, type ChatDetail, type ChatSummaryFields, type ChatDataFields, type ChatDataContent } from '../services/chat.js';
import { MessageService } from '../services/message.js';
import { LorebookService, type LorebookFields } from '../services/lorebook.js';
import { CharacterService } from '../services/character.js';
import type { OrderedRef } from '../db/index.js';
import { generateSortOrder } from './ordering.js';
import {
	chats, activeChat, activeCharacter, messages,
	chatLorebooks,
	activeCharacterId
} from './state.js';

export const DEFAULT_CHAT_SUMMARY: ChatSummaryFields = {
	title: 'New Chat',
	lastMessagePreview: '',
}

export const DEFAULT_CHAT_DATA: ChatDataFields = {
	systemPromptOverride: '',
	lorebookRefs: [],
	folders: {
		lorebooks: [],
	},
}

export async function selectChat(chatId: string, characterId: string) {
	if (get(activeCharacterId) !== characterId) return; // TODO: Error handling

	const detail = await ChatService.getDetail(chatId);
	activeChat.set(detail);
	if (!detail) return;

	messages.set(await MessageService.listByChat(chatId));

	const lorebooks = await LorebookService.listByOwner(chatId);
	chatLorebooks.set(lorebooks)
}

export function clearActiveChat() {
	activeChat.set(null);
	chatLorebooks.set([]);
	messages.set([]);
}

export async function createChat(
	characterId: string,
	summary: ChatSummaryFields = DEFAULT_CHAT_SUMMARY,
	data: ChatDataFields = DEFAULT_CHAT_DATA,
) {
	const char = get(activeCharacter);
	if (!char || char.id !== characterId) return; // TODO: Error handling

	const chat = await ChatService.create(char.id, summary, data);

	// Build updated chatRefs
	const existing = char.data.chatRefs ?? [];
	const chatRefs: OrderedRef[] = [
		...existing,
		{ id: chat.id, sortOrder: generateSortOrder(existing) }
	];
	await CharacterService.updateData(char.id, { chatRefs });

	activeCharacter.update((c) => (
		c && c.id === char.id
		? { 
			...c,
			data: { ...c.data, chatRefs },
			updatedAt: chat.updatedAt 
		}
		: c
	));
	chats.update((list) => [...list, chat]);
	return chat;
}

export async function updateChat(chatId: string, changes: Partial<ChatSummaryFields>) {
	const updated = await ChatService.updateSummary(chatId, changes);
	if (updated) {
		chats.update((list) => list.map((c) => (c.id === chatId ? updated : c)));
		activeChat.update((c) => (c && c.id === chatId ? { ...c, ...updated } : c));
	}
}

export async function updateChatData(chatId: string, changes: Partial<ChatDataContent>) {
	const result = await ChatService.updateData(chatId, changes);
	if (result) {
		activeChat.update((c) => (c && c.id === chatId ? { ...c, data: { ...c.data, ...changes }, updatedAt: result.updatedAt } : c));
	}
}

export async function deleteChat(chatId: string) {
	await ChatService.delete(chatId);

	const char = get(activeCharacter);
	
	if (char) {
		const chatRefs = (char.data.chatRefs ?? []).filter((r: OrderedRef) => r.id !== chatId);
		await CharacterService.updateData(char.id, { chatRefs });
		activeCharacter.set({ ...char, data: { ...char.data, chatRefs } });
		chats.update((list) => list.filter((c) => c.id !== chatId));
	}

	if (get(activeChat)?.id === chatId) {
		clearActiveChat();
	}
}

// ─── Chat-owned Message CRUD ─────────────────────────────────────

export async function sendMessage(role: 'user' | 'char' | 'system', content: string) {
	const chat = get(activeChat);
	if (!chat) return;

	const preview = content.substring(0, 50);

	// Parallelise: message creation and chat preview update are independent
	const [newMessage, updatedChat] = await Promise.all([
		MessageService.create(chat.id, { role, content }),
		ChatService.updateSummary(chat.id, { lastMessagePreview: preview })
	]);

	messages.update((prev) => [...prev, newMessage]);
	if (updatedChat) {
		chats.update((list) =>
			list.map((c) => (c.id === chat.id ? updatedChat : c))
		);
		activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
	}
}

export async function updateMessage(msgId: string, content: string) {
	const chat = get(activeChat);
	if (!chat) return;

	const updatedMsg = await MessageService.update(msgId, { content });
	if (updatedMsg) {
		messages.update((list) => list.map((m) => (m.id === msgId ? updatedMsg : m)));
	}

	// Only update chat preview if the edited message is the last one
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;
	if (isLastMessage) {
		const preview = content.substring(0, 50);
		const updatedChat = await ChatService.updateSummary(chat.id, { lastMessagePreview: preview });
		if (updatedChat) {
			chats.update((list) =>
				list.map((c) => (c.id === chat.id ? updatedChat : c))
			);
			activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
		}
	}
}

export async function deleteMessage(msgId: string) {
	const chat = get(activeChat);
	const currentMessages = get(messages);
	const isLastMessage =
		currentMessages.length > 0 && currentMessages[currentMessages.length - 1].id === msgId;

	await MessageService.delete(msgId);
	messages.update((list) => list.filter((m) => m.id !== msgId));

	if (chat && isLastMessage) {
		const remainingMessages = get(messages);
		const preview =
			remainingMessages.length > 0
				? remainingMessages[remainingMessages.length - 1].content.substring(0, 50)
				: '';
		const updatedChat = await ChatService.updateSummary(chat.id, { lastMessagePreview: preview });
		if (updatedChat) {
			chats.update((list) =>
				list.map((c) => (c.id === chat.id ? updatedChat : c))
			);
			activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
		}
	}
}

export function sortChatsByRefs(chats: Chat[], refs: OrderedRef[]): Chat[] {
	const orderMap = new Map(refs.map((r) => [r.id, r.sortOrder]));
	return [...chats].sort((a, b) => {
		const aOrder = orderMap.get(a.id) ?? '';
		const bOrder = orderMap.get(b.id) ?? '';
		return aOrder.localeCompare(bOrder);
	});
}



// ─── Chat-owned Lorebook CRUD ─────────────────────────────────────

export async function createChatLorebook(chatId: string, fields: LorebookFields) {
	const lb = await LorebookService.create(chatId, fields);

	const chat = get(activeChat);
	if (chat && chat.id === chatId) {
		const existing = chat.data.lorebookRefs ?? [];
		const lorebookRefs: OrderedRef[] = [...existing, { id: lb.id, sortOrder: generateSortOrder(existing) }];
		await ChatService.updateData(chatId, { lorebookRefs });
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		chatLorebooks.update((list) => [...list, lb]);
	}

	return lb;
}

export async function deleteChatLorebook(chatId: string, lorebookId: string) {
	await LorebookService.delete(lorebookId);

	const chat = get(activeChat);
	if (chat && chat.id === chatId) {
		const lorebookRefs = (chat.data.lorebookRefs ?? []).filter((r) => r.id !== lorebookId);
		await ChatService.updateData(chatId, { lorebookRefs });
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		chatLorebooks.update((list) => list.filter((lb) => lb.id !== lorebookId));
	}
}
