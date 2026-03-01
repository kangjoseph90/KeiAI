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
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import {
	chats,
	activeChat,
	activeCharacter,
	messages,
	chatLorebooks,
	activeCharacterId
} from './state.js';
import { loadInitialMessages } from './message.js';

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
	// 참조 데이터 검증
	const detail = await ChatService.getDetail(chatId);
	if (!detail || detail.characterId !== characterId || characterId !== get(activeCharacterId))
		return;

	// 검증 성공 시 채팅 로드
	clearActiveChat();
	activeChat.set(detail);
	await loadInitialMessages(chatId, 50);

	// Lorebook 로드
	const lorebooks = await LorebookService.listByOwner(chatId);
	chatLorebooks.set(sortByRefs(lorebooks, detail.data.lorebookRefs ?? []));

	// 캐릭터 채팅 페이지 업데이트
	const result = await CharacterService.updateData(characterId, { lastActiveChatId: chatId });
	activeCharacter.update((c) =>
		c && c.id === characterId && result // 마지막으로 active 캐릭터 참조 검증
			? {
					...c,
					data: result.data,
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
	if (!char || char.id !== characterId) return;

	// DB writes — always happen with explicit characterId
	const chat = await ChatService.create(characterId, summary, data);
	const existing = char.data.chatRefs ?? [];
	const chatRefs: OrderedRef[] = [
		...existing,
		{ id: chat.id, sortOrder: generateSortOrder(existing) }
	];
	const updatedCharacterData = await CharacterService.updateData(characterId, { chatRefs });
	if (!updatedCharacterData) {
		await ChatService.delete(chat.id, characterId);
		return;
	}

	// Store update — guard against context change
	if (get(activeCharacterId) !== characterId) return chat;

	activeCharacter.update((c) =>
		c && c.id === characterId
			? {
					...c,
					data: { ...c.data, chatRefs },
					updatedAt: updatedCharacterData.updatedAt
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
	const updated = await ChatService.updateData(chatId, changes);
	if (updated) {
		activeChat.update((c) =>
			c && c.id === chatId ? { ...c, data: updated.data, updatedAt: updated.updatedAt } : c
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

	chats.update((list) => list.map((c) => (c.id === chatId ? result : c)));
	activeChat.update((c) => {
		if (c && c.id === chatId) {
			return result;
		}
		return c;
	});
}

export async function deleteChat(chatId: string, characterId: string) {
	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const previousChatRefs = char.data.chatRefs ?? [];
		const chatRefs = (char.data.chatRefs ?? []).filter((r: OrderedRef) => r.id !== chatId);
		const updatedCharacterData = await CharacterService.updateData(characterId, { chatRefs });
		if (!updatedCharacterData) return;

		try {
			await ChatService.delete(chatId, characterId);
		} catch (error) {
			await CharacterService.updateData(characterId, { chatRefs: previousChatRefs });
			throw error;
		}

		// Store update — guard against context change
		if (get(activeCharacterId) === characterId) {
			activeCharacter.set({
				...char,
				data: { ...char.data, chatRefs },
				updatedAt: updatedCharacterData.updatedAt
			});
			chats.update((list) => list.filter((c) => c.id !== chatId));
		}
	} else {
		await ChatService.delete(chatId);
	}

	if (get(activeChat)?.id === chatId) {
		clearActiveChat();
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
	if (!chat || chat.id !== chatId) {
		await LorebookService.delete(lb.id);
		return;
	}

	const existing = chat.data.lorebookRefs ?? [];
	const lorebookRefs: OrderedRef[] = [
		...existing,
		{ id: lb.id, sortOrder: generateSortOrder(existing) }
	];
	const result = await ChatService.updateData(chatId, { lorebookRefs });
	if (!result) {
		await LorebookService.delete(lb.id);
		return;
	}

	activeChat.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
	chatLorebooks.update((list) => [...list, lb]);

	return lb;
}

export async function deleteChatLorebook(chatId: string, lorebookId: string) {
	await LorebookService.delete(lorebookId, chatId);

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
