import { get } from 'svelte/store';
import {
	ChatService,
	MessageService,
	LorebookService,
	CharacterService,
	type ChatFields,
	type ChatContent,
	type LorebookFields,
	type Lorebook
} from '$lib/services';
import type { OrderedRef, FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
	chats,
	activeChat,
	activeCharacter,
	messages,
	chatLorebooks,
	activeCharacterId,
	activeChatId
} from '../state';
import { loadInitialMessages } from './message';
import { getCharacter } from './character';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns chat from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getChat(chatId: string): Promise<import('$lib/services').Chat> {
	const active = get(activeChat);
	if (active?.id === chatId) return active;
	const cached = chats.get(chatId);
	if (cached) return cached;
	const db = await ChatService.get(chatId);
	if (!db) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	return db;
}

export async function selectChat(chatId: string, characterId: string): Promise<void> {
	const chat = await getChat(chatId);

	clearActiveChat();
	activeChat.set(chat);
	await loadInitialMessages(chatId, 50);

	const lorebooks = await LorebookService.listByOwner(chatId);
	chatLorebooks.setAll(sortByRefs(lorebooks, chat.lorebookRefs ?? []));

	const updated = await CharacterService.update(characterId, { lastActiveChatId: chatId });
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, lastActiveChatId: chatId } : c));
	}
}

export function clearActiveChat(): void {
	activeChat.set(null);
	chatLorebooks.clear();
	messages.clear();
}

export async function createChat(
	characterId: string,
	fields: DeepPartial<ChatFields> = {}
): Promise<import('$lib/services').Chat> {
	const char = await getCharacter(characterId);

	const chat = await ChatService.create(characterId, fields);

	const existingRefs = char.chatRefs || [];
	const chatRefs: OrderedRef[] = [
		...existingRefs,
		{ id: chat.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await CharacterService.update(characterId, { chatRefs });
	} catch (error) {
		await ChatService.delete(chat.id);
		throw error;
	}

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, chatRefs } : c));
		chats.set(chat.id, chat);
	}

	return chat;
}

export async function updateChat(chatId: string, changes: DeepPartial<ChatFields>): Promise<void> {
	const updated = await ChatService.update(chatId, changes);
	chats.set(chatId, updated);
	if (chatId === get(activeChatId)) {
		activeChat.set(updated);
	}
}

export async function updateChatContent(
	chatId: string,
	changes: DeepPartial<ChatContent>
): Promise<void> {
	const updated = await ChatService.update(chatId, changes);
	chats.set(chatId, updated);
	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, ...updated } : c));
	}
}

export async function deleteChat(chatId: string, characterId: string): Promise<void> {
	const char = await getCharacter(characterId);

	const existingRefs = char.chatRefs || [];
	const chatRefs = existingRefs.filter((r) => r.id !== chatId);
	await CharacterService.update(characterId, { chatRefs });

	try {
		await ChatService.delete(chatId);
	} catch (error) {
		await CharacterService.update(characterId, { chatRefs: existingRefs });
		throw error;
	}

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, chatRefs } : c));
		chats.delete(chatId);
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
	const forkMessage = await MessageService.get(messageId);
	if (!forkMessage) {
		throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
	}
	const chatId = forkMessage.chatId;

	const beforeMessages = await MessageService.getMessagesBefore(
		chatId,
		forkMessage.sortOrder,
		Number.MAX_SAFE_INTEGER
	);
	const allMessages = [...beforeMessages, forkMessage];

	const originalChat = await getChat(chatId);
	const characterId = originalChat.characterId;

	const { lorebookRefs: _, ...fieldsCopy } = originalChat;

	const newChat = await ChatService.create(characterId, {
		...fieldsCopy,
		title: `${originalChat.title} (Fork)`,
		messageCount: allMessages.length
	});

	await Promise.all(
		allMessages.map((msg) =>
			MessageService.create(
				newChat.id,
				{
					role: msg.role,
					swipes: msg.swipes,
					activeSwipeId: msg.activeSwipeId
				},
				msg.sortOrder
			)
		)
	);

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
		await ChatService.update(newChat.id, { lorebookRefs });
	}

	const char = await getCharacter(characterId);
	const existingRefs = char.chatRefs || [];
	const chatRefs: OrderedRef[] = [
		...existingRefs,
		{ id: newChat.id, sortOrder: generateSortOrder(existingRefs) }
	];

	try {
		await CharacterService.update(characterId, { chatRefs });
	} catch (error) {
		await ChatService.delete(newChat.id);
		throw error;
	}

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, chatRefs } : c));
		chats.set(newChat.id, newChat);
	}

	return newChat.id;
}

// ─── Chat-owned Lorebook CRUD ─────────────────────────────────────

export async function createChatLorebook(
	chatId: string,
	fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
	const chat = await getChat(chatId);

	const lb = await LorebookService.create(chatId, fields);

	const existingRefs = chat.lorebookRefs || [];
	const lorebookRefs: OrderedRef[] = [
		...existingRefs,
		{ id: lb.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await ChatService.update(chatId, { lorebookRefs });
	} catch (error) {
		await LorebookService.delete(lb.id);
		throw error;
	}

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, lorebookRefs } : c));
		chatLorebooks.set(lb.id, lb);
	}

	return lb;
}

export async function deleteChatLorebook(chatId: string, lorebookId: string): Promise<void> {
	const chat = await getChat(chatId);

	const existingRefs = chat.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await ChatService.update(chatId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId);
	} catch (error) {
		await ChatService.update(chatId, { lorebookRefs: existingRefs });
		throw error;
	}

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, lorebookRefs } : c));
		chatLorebooks.delete(lorebookId);
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
	const chat = await getChat(chatId);

	const folders = chat.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = { ...folders, [folderType]: [...typeFolders, newFolder] };

	await ChatService.update(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, folders: updatedFolders } : c));
	}

	return newFolder;
}

export async function updateChatFolder(
	chatId: string,
	folderType: ChatFolderType,
	folderId: string,
	changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	const chat = await getChat(chatId);

	const folders = chat.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => (f.id === folderId ? { ...f, ...changes } : f));

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ChatService.update(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, folders: updatedFolders } : c));
	}
}

export async function deleteChatFolder(
	chatId: string,
	folderType: ChatFolderType,
	folderId: string
): Promise<void> {
	const chat = await getChat(chatId);

	const folders = chat.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ChatService.update(chatId, { folders: updatedFolders });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, folders: updatedFolders } : c));
	}
}

export async function moveChatItem(
	chatId: string,
	folderType: ChatFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	const chat = await getChat(chatId);

	let refKey: keyof typeof chat;
	switch (folderType) {
		case 'lorebooks':
			refKey = 'lorebookRefs';
			break;
		default:
			return;
	}

	const refs = (chat[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	await ChatService.update(chatId, { [refKey]: updatedRefs });

	if (chatId === get(activeChatId)) {
		activeChat.update((c) => (c ? { ...c, [refKey]: updatedRefs } : c));
	}
}
