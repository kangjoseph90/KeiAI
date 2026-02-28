import { get } from 'svelte/store';
import {
	ChatService,
	type Chat,
	type ChatSummaryFields,
	type ChatDataFields,
	type ChatDataContent
} from '../services/chat.js';
import { MessageService } from '../services/message.js';
import { LorebookService, type LorebookFields } from '../services/lorebook.js';
import { CharacterService } from '../services/character.js';
import type { OrderedRef } from '../db/index.js';
import { generateSortOrder, sortByRefs } from './ordering.js';
import {
	chats,
	activeChat,
	activeCharacter,
	messages,
	chatLorebooks,
	activeCharacterId
} from './state.js';

export const DEFAULT_CHAT_SUMMARY: ChatSummaryFields = {
	title: 'New Chat',
	lastMessagePreview: ''
};

export const DEFAULT_CHAT_DATA: ChatDataFields = {
	systemPromptOverride: '',
	lorebookRefs: [],
	folders: {
		lorebooks: []
	}
};

export async function selectChat(chatId: string, characterId: string) {
	if (get(activeCharacterId) !== characterId) return; // TODO: Error handling

	const detail = await ChatService.getDetail(chatId);
	activeChat.set(detail);
	if (!detail) return;

	// Load the 50 most recent messages initially
	messages.set(await MessageService.getMessagesBefore(chatId, '\uffff', 50));

	const lorebooks = await LorebookService.listByOwner(chatId);
	chatLorebooks.set(sortByRefs(lorebooks, detail.data.lorebookRefs ?? []));

	// Save last active chat to character
	const result = await CharacterService.updateData(characterId, { lastActiveChatId: chatId });
	if (!result) return;
	activeCharacter.update((c) =>
		c
			? {
					...c,
					data: { ...c.data, lastActiveChatId: chatId },
					updatedAt: result.updatedAt
				}
			: c
	);
}

export function clearActiveChat() {
	activeChat.set(null);
	chatLorebooks.set([]);
	messages.set([]);
}

export async function createChat(
	characterId: string,
	summary: ChatSummaryFields = DEFAULT_CHAT_SUMMARY,
	data: ChatDataFields = DEFAULT_CHAT_DATA
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

	activeCharacter.update((c) =>
		c && c.id === char.id
			? {
					...c,
					data: { ...c.data, chatRefs },
					updatedAt: chat.updatedAt
				}
			: c
	);
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
		activeChat.update((c) =>
			c && c.id === chatId
				? { ...c, data: { ...c.data, ...changes }, updatedAt: result.updatedAt }
				: c
		);
	}
}

export async function updateChatFull(
	chatId: string,
	summaryChanges: Partial<ChatSummaryFields>,
	dataChanges: Partial<ChatDataContent>
) {
	const result = await ChatService.update(chatId, summaryChanges, dataChanges);
	if (!result) return;

	if (result.summary) {
		chats.update((list) =>
			list.map((c) =>
				c.id === chatId ? { ...c, ...result.summary, updatedAt: result.updatedAt } : c
			)
		);
	}
	activeChat.update((c) => {
		if (c && c.id === chatId) {
			return {
				...c,
				...(result.summary || {}),
				data: { ...c.data, ...(result.data || {}) },
				updatedAt: result.updatedAt
			};
		}
		return c;
	});
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

export async function loadOlderMessages(limit = 50) {
	const chat = get(activeChat);
	const msgs = get(messages);
	if (!chat || msgs.length === 0) return;

	const oldestCursor = msgs[0].sortOrder;
	const olderMsgs = await MessageService.getMessagesBefore(chat.id, oldestCursor, limit);

	if (olderMsgs.length > 0) {
		messages.update((list) => [...olderMsgs, ...list]);
	}
}

export async function loadNewerMessages(limit = 50) {
	const chat = get(activeChat);
	const msgs = get(messages);
	if (!chat || msgs.length === 0) return;

	const newestCursor = msgs[msgs.length - 1].sortOrder;
	const newerMsgs = await MessageService.getMessagesAfter(chat.id, newestCursor, limit);

	if (newerMsgs.length > 0) {
		messages.update((list) => [...list, ...newerMsgs]);
	}
}

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
		chats.update((list) => list.map((c) => (c.id === chat.id ? updatedChat : c)));
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
			chats.update((list) => list.map((c) => (c.id === chat.id ? updatedChat : c)));
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
			chats.update((list) => list.map((c) => (c.id === chat.id ? updatedChat : c)));
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
		const lorebookRefs: OrderedRef[] = [
			...existing,
			{ id: lb.id, sortOrder: generateSortOrder(existing) }
		];
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

// ─── Chat-owned Folder & Item Management ──────────────────────

export async function createChatFolder(chatId: string, name: string, parentId?: string) {
	const chat = get(activeChat);
	if (!chat || chat.id !== chatId) return;

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const newFolder = {
		id: crypto.randomUUID(),
		name,
		sortOrder: generateSortOrder(lorebookFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = {
		...folders,
		lorebooks: [...lorebookFolders, newFolder]
	};

	const result = await ChatService.updateData(chatId, { folders: updatedFolders });
	if (result) {
		activeChat.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders }, updatedAt: result.updatedAt } : c
		);
	}
	return newFolder;
}

export async function updateChatFolder(
	chatId: string,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
) {
	const chat = get(activeChat);
	if (!chat || chat.id !== chatId) return;

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const updatedLorebookFolders = lorebookFolders.map((f) =>
		f.id === folderId ? { ...f, ...changes } : f
	);

	const updatedFolders = {
		...folders,
		lorebooks: updatedLorebookFolders
	};

	const result = await ChatService.updateData(chatId, { folders: updatedFolders });
	if (!result) return;
	activeChat.update((c) =>
		c ? { ...c, data: { ...c.data, folders: updatedFolders }, updatedAt: result.updatedAt } : c
	);
}

export async function deleteChatFolder(chatId: string, folderId: string) {
	const chat = get(activeChat);
	if (!chat || chat.id !== chatId) return;

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const updatedLorebookFolders = lorebookFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		lorebooks: updatedLorebookFolders
	};

	const result = await ChatService.updateData(chatId, { folders: updatedFolders });
	if (!result) return;
	activeChat.update((c) =>
		c ? { ...c, data: { ...c.data, folders: updatedFolders }, updatedAt: result.updatedAt } : c
	);
}

export async function moveChatLorebook(
	chatId: string,
	lorebookId: string,
	newFolderId?: string,
	newSortOrder?: string
) {
	const chat = get(activeChat);
	if (!chat || chat.id !== chatId) return;

	const refs = (chat.data.lorebookRefs as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== lorebookId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	const result = await ChatService.updateData(chatId, { lorebookRefs: updatedRefs });
	if (!result) return;
	activeChat.update((c) =>
		c ? { ...c, data: { ...c.data, lorebookRefs: updatedRefs }, updatedAt: result.updatedAt } : c
	);
}
