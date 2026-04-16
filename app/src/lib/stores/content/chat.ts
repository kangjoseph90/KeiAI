import { get } from 'svelte/store';
import {
	ChatService,
	MessageService,
	LorebookService,
	CharacterService,
	type ChatDetail,
	type ChatSummaryFields,
	type ChatDataFields,
	type ChatDataContent,
	type LorebookFields,
	type Lorebook
} from '$lib/services';
import type { OrderedRef, FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
	chats,
	activeChat,
	activeCharacter,
	messageMap,
	chatLorebooks,
	activeCharacterId,
	activeChatId
} from '../state';
import { loadInitialMessages } from './message';
import { getCharacterDetail } from './character';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns chat detail from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getChatDetail(chatId: string): Promise<ChatDetail> {
	const active = get(activeChat);
	if (active?.id === chatId) return active;
	const db = await ChatService.getDetail(chatId);
	if (!db) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	return db;
}

export async function selectChat(chatId: string, characterId: string): Promise<void> {
	const detail = await getChatDetail(chatId);

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
	messageMap.set(new Map());
}

export async function createChat(
	characterId: string,
	summary: DeepPartial<ChatSummaryFields> = {},
	data: DeepPartial<ChatDataFields> = {}
): Promise<ChatDetail> {
	const char = await getCharacterDetail(characterId);

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
		await ChatService.delete(chat.id);
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, chatRefs } } : c));
		chats.update((list) => [...list, chat]);
	}

	return chat;
}

export async function updateChat(
	chatId: string,
	changes: DeepPartial<ChatSummaryFields>
): Promise<void> {
	const updated = await ChatService.updateSummary(chatId, changes);
	chats.update((list) => list.map((c) => (c.id === chatId ? updated : c)));
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, ...updated } : c));
	}
}

export async function updateChatData(
	chatId: string,
	changes: DeepPartial<ChatDataContent>
): Promise<void> {
	const data = await ChatService.updateData(chatId, changes);
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data } : c));
	}
}

export async function updateChatFull(
	chatId: string,
	summaryChanges: DeepPartial<ChatSummaryFields>,
	dataChanges: DeepPartial<ChatDataContent>
): Promise<void> {
	const result = await ChatService.update(chatId, summaryChanges, dataChanges);
	chats.update((list) => list.map((c) => (c.id === chatId ? result : c)));
	if (chatId === get(activeChatId)) {
		activeChat.set(result);
	}
}

export async function deleteChat(chatId: string, characterId: string): Promise<void> {
	const char = await getCharacterDetail(characterId);

	// Remove from parent's refs
	const existingRefs = char.data.chatRefs || [];
	const chatRefs = existingRefs.filter((r) => r.id !== chatId);
	await CharacterService.updateData(characterId, { chatRefs });

	try {
		await ChatService.delete(chatId);
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

// ─── Fork ──────────────────────────────────────────────────────────

/**
 * Forks a chat at a specific message, copying all history up to that point
 * into a new thread. Includes chat-specific lorebooks.
 */
export async function forkChat(messageId: string): Promise<string> {
	// Find fork point message and its chat context
	const forkMessage = await MessageService.get(messageId);
	if (!forkMessage) {
		throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
	}
	const chatId = forkMessage.chatId;

	// Find preceding history
	const beforeMessages = await MessageService.getMessagesBefore(
		chatId,
		forkMessage.sortOrder,
		Number.MAX_SAFE_INTEGER
	);
	const allMessages = [...beforeMessages, forkMessage];

	// Fetch original chat metadata and character context
	const originalChat = await ChatService.getDetail(chatId);
	if (!originalChat) {
		throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	}
	const characterId = originalChat.characterId;

	const { lorebookRefs: _, ...dataCopy } = originalChat.data;
	const lastMsg = allMessages[allMessages.length - 1];
	const lastMessagePreview =
		lastMsg.swipes[lastMsg.activeSwipeIndex]?.content?.substring(0, 50) ?? '';

	const newChat = await ChatService.create(
		characterId,
		{
			title: `${originalChat.title} (Fork)`,
			messageCount: allMessages.length,
			lastMessagePreview
		},
		dataCopy
	);

	// Batch copy messages concurrently
	await Promise.all(
		allMessages.map((msg) =>
			MessageService.create(
				newChat.id,
				{
					role: msg.role,
					swipes: msg.swipes,
					activeSwipeIndex: msg.activeSwipeIndex
				},
				msg.sortOrder
			)
		)
	);

	// Copy lorebooks and reconstruct references
	const lorebooks = await LorebookService.listByOwner(chatId);
	const copiedLorebooks = await Promise.all(
		lorebooks.map(async (lb) => {
			const { id: _lbId, ownerId: _ownerId, ...fields } = lb;
			return LorebookService.create(newChat.id, fields);
		})
	);

	const lorebookRefs: OrderedRef[] = [];
	for (const copiedLb of copiedLorebooks) {
		lorebookRefs.push({ id: copiedLb.id, sortOrder: generateSortOrder(lorebookRefs) });
	}

	if (lorebookRefs.length > 0) {
		await ChatService.updateData(newChat.id, { lorebookRefs });
	}

	// Update character's chat references with safe rollback
	const char = await getCharacterDetail(characterId);
	const existingRefs = char.data.chatRefs || [];
	const chatRefs: OrderedRef[] = [
		...existingRefs,
		{ id: newChat.id, sortOrder: generateSortOrder(existingRefs) }
	];

	try {
		await CharacterService.updateData(characterId, { chatRefs });
	} catch (error) {
		await ChatService.delete(newChat.id);
		throw error;
	}

	// Update store for UI responsiveness
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, chatRefs } } : c));
		chats.update((list) => [...list, newChat]);
	}

	return newChat.id;
}

// ─── Chat-owned Lorebook CRUD ─────────────────────────────────────

export async function createChatLorebook(
	chatId: string,
	fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
	const chat = await getChatDetail(chatId);

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
	const chat = await getChatDetail(chatId);

	// Remove from parent's refs
	const existingRefs = chat.data.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await ChatService.updateData(chatId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId);
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

export type ChatFolderType = 'lorebooks';

export async function createChatFolder(
	chatId: string,
	folderType: ChatFolderType,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	const chat = await getChatDetail(chatId);

	const folders = chat.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = { ...folders, [folderType]: [...typeFolders, newFolder] };

	await ChatService.updateData(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
	}

	return newFolder;
}

export async function updateChatFolder(
	chatId: string,
	folderType: ChatFolderType,
	folderId: string,
	changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	const chat = await getChatDetail(chatId);

	const folders = chat.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => (f.id === folderId ? { ...f, ...changes } : f));

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ChatService.updateData(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
	}
}

export async function deleteChatFolder(
	chatId: string,
	folderType: ChatFolderType,
	folderId: string
): Promise<void> {
	const chat = await getChatDetail(chatId);

	const folders = chat.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ChatService.updateData(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
	}
}

export async function moveChatItem(
	chatId: string,
	folderType: ChatFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	const chat = await getChatDetail(chatId);

	let refKey: keyof typeof chat.data;
	switch (folderType) {
		case 'lorebooks':
			refKey = 'lorebookRefs';
			break;
		default:
			return;
	}

	const refs = (chat.data[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	await ChatService.updateData(chatId, { [refKey]: updatedRefs });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, data: { ...c.data, [refKey]: updatedRefs } } : c));
	}
}
