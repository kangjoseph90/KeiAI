import { writable, get } from 'svelte/store';
import { CharacterService, type Character } from '../services/character.js';
import { ChatService, type Chat } from '../services/chat.js';
import { MessageService, type Message } from '../services/message.js';

import { SettingsService, type AppSettings } from '../services/settings.js';

// ==========================================
// Level 1: Global State (Always loaded)
// ==========================================

export const appSettings = writable<AppSettings | null>(null);
export const globalCharacters = writable<Character[]>([]);

// Initialize Global Layer
export async function loadGlobalState() {
	const settings = await SettingsService.get();
	appSettings.set(settings);

	const chars = await CharacterService.getAll();
	globalCharacters.set(chars);
}

// Global Level Actions
export async function updateSettings(newSettings: Partial<AppSettings>) {
	const current = get(appSettings) || {};
	const updated = { ...current, ...newSettings } as AppSettings;
	await SettingsService.update(updated);
	appSettings.set(updated);
}

export async function createCharacter(name: string, description: string, prompt: string) {
	await CharacterService.create({ name, shortDescription: description }, { systemPrompt: prompt });
	await loadGlobalState();
}

export async function updateCharacter(id: string, summary: Partial<import('../services/character.js').CharacterSummary>, data?: Partial<import('../services/character.js').CharacterData>) {
	await CharacterService.update(id, summary, data);
	await loadGlobalState();
	if (get(activeCharacter)?.id === id) {
		await selectCharacter(id);
	}
}

export async function deleteCharacter(id: string) {
	await CharacterService.delete(id);
	await loadGlobalState();
	if (get(activeCharacter)?.id === id) {
		clearActiveCharacter();
	}
}

// ==========================================
// Level 2: Active Character Context
// ==========================================

export const activeCharacter = writable<Character | null>(null);
export const activeCharacterChats = writable<Chat[]>([]);

export async function selectCharacter(characterId: string) {
	// Clean up lower layers to free memory
	activeChat.set(null);
	activeMessages.set([]);
	activeCharacterChats.set([]);

	// Fetch requested character full data and their chat summaries
	const char = await CharacterService.getById(characterId);
	if (!char) {
		activeCharacter.set(null);
		return;
	}
	activeCharacter.set(char);

	const chats = await ChatService.getByCharacterId(characterId);
	activeCharacterChats.set(chats);
}

export function clearActiveCharacter() {
	activeCharacter.set(null);
	activeCharacterChats.set([]);
	clearActiveChat();
}

// Character Level Actions
export async function createChat(title: string) {
	const char = get(activeCharacter);
	if (!char) return;
	await ChatService.create(char.id, title);
	await refreshActiveCharacterChats();
}

export async function updateChat(chatId: string, summary: Partial<import('../services/chat.js').ChatSummary>) {
	await ChatService.update(chatId, summary);
	await refreshActiveCharacterChats();
	// If it's the active chat, update its local copy
	const currentActChat = get(activeChat);
	if (currentActChat && currentActChat.id === chatId) {
        // Technically just the summary changed
		activeChat.set({ ...currentActChat, summary: { ...currentActChat.summary, ...summary } });
	}
}

export async function deleteChat(chatId: string) {
	await ChatService.delete(chatId);
	await refreshActiveCharacterChats();
	if (get(activeChat)?.id === chatId) {
		clearActiveChat();
	}
}


// ==========================================
// Level 3: Active Chat Context
// ==========================================

export const activeChat = writable<Chat | null>(null);
export const activeMessages = writable<Message[]>([]);

export async function selectChat(chatId: string) {
	// Note: You might want a dedicated ChatService.getById if you need full chat rules/lorebooks
	// For now, we find the summary from the active character's list
	const chats = get(activeCharacterChats);
	const chat = chats.find(c => c.id === chatId) || null;
	activeChat.set(chat);

	if (chat) {
		const msgs = await MessageService.getByChatId(chatId);
		activeMessages.set(msgs);
	} else {
		activeMessages.set([]);
	}
}

export function clearActiveChat() {
	activeChat.set(null);
	activeMessages.set([]); // Free memory
}

// Helper: Quick Refresh of a specific layer
export async function refreshActiveCharacterChats() {
	const char = get(activeCharacter);
	if (char) {
		const chats = await ChatService.getByCharacterId(char.id);
		activeCharacterChats.set(chats);
	}
}

export async function refreshActiveMessages() {
	const chat = get(activeChat);
	if (chat) {
		const msgs = await MessageService.getByChatId(chat.id);
		activeMessages.set(msgs);
	}
}

// Chat Level Actions (Messages)
export async function sendChatMessage(role: 'user' | 'char' | 'system', content: string) {
	const chat = get(activeChat);
	if (!chat) return;
	await MessageService.create(chat.id, { role, content });
	await refreshActiveMessages();
	await refreshActiveCharacterChats(); // Updates preview in the chat list
}

export async function updateChatMessage(msgId: string, content: string) {
	const chat = get(activeChat);
	if (!chat) return;
	await MessageService.update(msgId, { content });
	await refreshActiveMessages();
	await refreshActiveCharacterChats(); // Might update preview if it was the last message
}

export async function deleteChatMessage(msgId: string) {
	await MessageService.delete(msgId);
	await refreshActiveMessages();
	await refreshActiveCharacterChats();
}
