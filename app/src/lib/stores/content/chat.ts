import { get } from 'svelte/store';
import {
	ChatService,
	type Chat,
	type ChatDetail,
	type ChatSummaryFields,
	type ChatDataFields,
	type ChatDataContent
} from '../../services/content/chat.js';
import { MessageService } from '../../services/content/message.js';
import { LorebookService, type LorebookFields, type Lorebook } from '../../services/content/lorebook.js';
import { CharacterService } from '../../services/content/character.js';
import type { OrderedRef, FolderDef } from '../../shared/types.js';
import { generateSortOrder, sortByRefs } from '../../shared/ordering.js';
import {
	chats,
	activeChat,
	activeCharacter,
	messages,
	chatLorebooks,
	activeCharacterId,
	activeChatId
} from '../state.js';
import { loadInitialMessages } from './message.js';
import { AppError } from '../../shared/errors.js';
import { generateId } from '../../shared/id.js';

export async function selectChat(chatId: string, characterId: string): Promise<void> {
	const detail = await ChatService.getDetail(chatId);

	if (!detail) {
		throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	}

	// 검증 성공 시 채팅 로드
	clearActiveChat();
	activeChat.set(detail);
	await loadInitialMessages(chatId, 50);

	// Lorebook 로드
	const lorebooks = await LorebookService.listByOwner(chatId);
	chatLorebooks.set(sortByRefs(lorebooks, detail.data.lorebookRefs ?? []));

	// 캐릭터 채팅 페이지 업데이트
	const data = await CharacterService.updateData(characterId, { lastActiveChatId: chatId });
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data } : c));
	}
}

export function clearActiveChat(): void {
	activeChat.set(null);
	chatLorebooks.set([]);
	messages.set([]);
}

export async function createChat(
	characterId: string,
	summary: Partial<ChatSummaryFields> = {},
	data: Partial<ChatDataFields> = {}
): Promise<ChatDetail> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

	// Create Record in DB
	const chat = await ChatService.create(characterId, summary, data);

	// Update parent's refs
	const existingRefs = char.data.chatRefs || [];
	const chatRefs: OrderedRef[] = [
		...existingRefs,
		{ id: chat.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await CharacterService.updateData(characterId, { chatRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await ChatService.delete(chat.id, characterId);
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, chatRefs } } : c));
		chats.update((list) => [...list, chat]);
	}
	
	return chat;
}

export async function updateChat(chatId: string, changes: Partial<ChatSummaryFields>): Promise<void> {
	const updated = await ChatService.updateSummary(chatId, changes);
	chats.update((list) => list.map((c) => (c.id === chatId ? updated : c)));
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, ...updated } : c));
	}
}

export async function updateChatData(chatId: string, changes: Partial<ChatDataContent>): Promise<void> {
	const data = await ChatService.updateData(chatId, changes);
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data } : c));
	}
}

export async function updateChatFull(
	chatId: string,
	summaryChanges: Partial<ChatSummaryFields>,
	dataChanges: Partial<ChatDataContent>
): Promise<void> {
	const result = await ChatService.update(chatId, summaryChanges, dataChanges);
	chats.update((list) => list.map((c) => (c.id === chatId ? result : c)));
	if (chatId === get(activeChatId)) {
		activeChat.set(result);
	}
}

export async function deleteChat(chatId: string, characterId: string): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

	// Remove from parent's refs
	const existingRefs = char.data.chatRefs || [];
	const chatRefs = existingRefs.filter((r) => r.id !== chatId);
	await CharacterService.updateData(characterId, { chatRefs });

	try {
		await ChatService.delete(chatId, characterId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await CharacterService.updateData(characterId, { chatRefs: existingRefs });
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, chatRefs } } : c));
		chats.update((list) => list.filter((c) => c.id !== chatId));
	}

	if (chatId === get(activeChatId)) {
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

export async function createChatLorebook(chatId: string, fields: Partial<LorebookFields>): Promise<Lorebook> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	// Create Record in DB
	const lb = await LorebookService.create(chatId, fields);

	// Update parent's refs
	const existingRefs = chat.data.lorebookRefs || [];
	const lorebookRefs: OrderedRef[] = [
		...existingRefs,
		{ id: lb.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await ChatService.updateData(chatId, { lorebookRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await LorebookService.delete(lb.id);
		throw error;
	}

	// Update Store
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		chatLorebooks.update((list) => [...list, lb]);
	}

	return lb;
}

export async function deleteChatLorebook(chatId: string, lorebookId: string): Promise<void> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	// Remove from parent's refs
	const existingRefs = chat.data.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await ChatService.updateData(chatId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId, chatId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await ChatService.updateData(chatId, { lorebookRefs: existingRefs });
		throw error;
	}

	// Update Store
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		chatLorebooks.update((list) => list.filter((lb) => lb.id !== lorebookId));
	}
}

// ─── Chat-owned Folder & Item Management ──────────────────────

export async function createChatFolder(
	chatId: string,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const newFolder = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(lorebookFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = { ...folders, lorebooks: [...lorebookFolders, newFolder] };

	await ChatService.updateData(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
	
	return newFolder;
}

export async function updateChatFolder(
	chatId: string,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const updatedLorebookFolders = lorebookFolders.map((f) =>
		f.id === folderId ? { ...f, ...changes } : f
	);

	const updatedFolders = {
		...folders,
		lorebooks: updatedLorebookFolders
	};

	await ChatService.updateData(chatId, { folders: updatedFolders });
	
	if (chatId === get(activeChatId)) {
		activeChat.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
}

export async function deleteChatFolder(chatId: string, folderId: string): Promise<void> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	const folders = chat.data.folders ?? {};
	const lorebookFolders = folders.lorebooks ?? [];

	const updatedLorebookFolders = lorebookFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		lorebooks: updatedLorebookFolders
	};

	await ChatService.updateData(chatId, { folders: updatedFolders });
	
	if (chatId === get(activeChatId)) {
		activeChat.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
}

export async function moveChatLorebook(
	chatId: string,
	lorebookId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	// Use cached active chat if possible
	const chat = chatId === get(activeChatId)
		? get(activeChat)
		: await ChatService.getDetail(chatId);

	if (!chat) {
		throw new AppError(`NOT_FOUND`, `Chat not found`);
	}

	const refs = (chat.data.lorebookRefs as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== lorebookId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	await ChatService.updateData(chatId, { lorebookRefs: updatedRefs });
	
	if (chatId === get(activeChatId)) {
		activeChat.update((c) =>
			c ? { ...c, data: { ...c.data, lorebookRefs: updatedRefs } } : c
		);
	}
}
