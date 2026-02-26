/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    characters (summaries), appSettings   — always loaded
 * Level 2 (Character): activeCharacter (detail), activeChats — loaded on select
 * Level 3 (Chat):      activeChat (detail), messages         — loaded on enter
 *
 * Leaving a layer clears its plaintext from memory.
 * Cross-service orchestration lives here, not inside services.
 */

import { writable, get } from 'svelte/store';
import {
	CharacterService,
	type Character,
	type CharacterDetail,
	type CharacterSummaryFields,
	type CharacterDataFields
} from '../services/character.js';
import {
	ChatService,
	type Chat,
	type ChatDetail,
	type ChatSummaryFields,
	type ChatDataFields
} from '../services/chat.js';
import { MessageService, type Message } from '../services/message.js';
import { SettingsService, type AppSettings } from '../services/settings.js';

// ══════════════════════════════════════════════════
// Level 1: Global State (always loaded)
// ══════════════════════════════════════════════════

export const appSettings = writable<AppSettings | null>(null);
export const characters = writable<Character[]>([]);

export async function loadGlobalState() {
	appSettings.set(await SettingsService.get());
	characters.set(await CharacterService.list());
}

export async function updateSettings(changes: Partial<AppSettings>) {
	const current = get(appSettings) || ({} as AppSettings);
	const updated = { ...current, ...changes } as AppSettings;
	await SettingsService.update(updated);
	appSettings.set(updated);
}

export async function createCharacter(
	name: string,
	shortDescription: string,
	systemPrompt: string,
	greetingMessage?: string
) {
	await CharacterService.create({ name, shortDescription }, { systemPrompt, greetingMessage });
	characters.set(await CharacterService.list());
}

export async function deleteCharacter(id: string) {
	await CharacterService.delete(id);
	characters.set(await CharacterService.list());
	if (get(activeCharacter)?.id === id) {
		clearActiveCharacter();
	}
}

// ══════════════════════════════════════════════════
// Level 2: Active Character Context
// ══════════════════════════════════════════════════

export const activeCharacter = writable<CharacterDetail | null>(null);
export const activeChats = writable<Chat[]>([]);

export async function selectCharacter(characterId: string) {
	clearActiveChat();
	activeChats.set([]);

	const detail = await CharacterService.getDetail(characterId);
	activeCharacter.set(detail);

	if (detail) {
		activeChats.set(await ChatService.listByCharacter(characterId));
	}
}

export function clearActiveCharacter() {
	activeCharacter.set(null);
	activeChats.set([]);
	clearActiveChat();
}

export async function updateCharacterSummary(
	id: string,
	changes: Partial<CharacterSummaryFields>
) {
	await CharacterService.updateSummary(id, changes);
	characters.set(await CharacterService.list());
	if (get(activeCharacter)?.id === id) {
		activeCharacter.set(await CharacterService.getDetail(id));
	}
}

export async function updateCharacterData(id: string, changes: Partial<CharacterDataFields>) {
	await CharacterService.updateData(id, changes);
	if (get(activeCharacter)?.id === id) {
		activeCharacter.set(await CharacterService.getDetail(id));
	}
}

// Character-level actions

export async function createChat(title: string) {
	const char = get(activeCharacter);
	if (!char) return;
	await ChatService.create(char.id, title);
	activeChats.set(await ChatService.listByCharacter(char.id));
}

export async function updateChat(chatId: string, changes: Partial<ChatSummaryFields>) {
	await ChatService.updateSummary(chatId, changes);
	await refreshActiveChats();
	const current = get(activeChat);
	if (current?.id === chatId) {
		activeChat.set(await ChatService.getDetail(chatId));
	}
}

export async function updateChatData(chatId: string, changes: Partial<ChatDataFields>) {
	await ChatService.updateData(chatId, changes);
	const current = get(activeChat);
	if (current?.id === chatId) {
		activeChat.set(await ChatService.getDetail(chatId));
	}
}

export async function deleteChat(chatId: string) {
	await ChatService.delete(chatId);
	await refreshActiveChats();
	if (get(activeChat)?.id === chatId) {
		clearActiveChat();
	}
}

// ══════════════════════════════════════════════════
// Level 3: Active Chat Context
// ══════════════════════════════════════════════════

export const activeChat = writable<ChatDetail | null>(null);
export const messages = writable<Message[]>([]);

export async function selectChat(chatId: string) {
	const detail = await ChatService.getDetail(chatId);
	activeChat.set(detail);
	messages.set(detail ? await MessageService.listByChat(chatId) : []);
}

export function clearActiveChat() {
	activeChat.set(null);
	messages.set([]);
}

export async function sendMessage(role: 'user' | 'char' | 'system', content: string) {
	const chat = get(activeChat);
	if (!chat) return;

	await MessageService.create(chat.id, { role, content });

	// Orchestration: update chat preview
	await ChatService.updateSummary(chat.id, {
		lastMessagePreview: content.substring(0, 50)
	});

	messages.set(await MessageService.listByChat(chat.id));
	await refreshActiveChats();
}

export async function updateMessage(msgId: string, content: string) {
	const chat = get(activeChat);
	if (!chat) return;

	await MessageService.update(msgId, { content });
	await ChatService.updateSummary(chat.id, {
		lastMessagePreview: content.substring(0, 50)
	});

	messages.set(await MessageService.listByChat(chat.id));
	await refreshActiveChats();
}

export async function deleteMessage(msgId: string) {
	await MessageService.delete(msgId);
	const chat = get(activeChat);
	if (chat) {
		messages.set(await MessageService.listByChat(chat.id));
	}
}

// ─── Internal ────────────────────────────────────────────────────────

async function refreshActiveChats() {
	const char = get(activeCharacter);
	if (char) {
		activeChats.set(await ChatService.listByCharacter(char.id));
	}
}
