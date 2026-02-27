/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    characters, personas, promptPresets, appSettings — always loaded
 * Level 2 (Character): activeCharacter (detail), activeChats            — loaded on select
 * Level 3 (Chat):      activeChat (detail), messages, shared resources  — loaded on enter
 *
 * Relationship patterns:
 *   1:N (parent→child): Parent's blob holds OrderedRef[] → fetch children by ID batch
 *   N:M (consumer→resource): Consumer's blob holds ResourceRef[] → load with enabled state
 *   Exception: messages use chatId FK + createdAt ordering
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
import {
	PersonaService,
	type Persona,
	type PersonaDetail,
	type PersonaSummaryFields,
	type PersonaDataFields
} from '../services/persona.js';
import {
	PromptPresetService,
	type PromptPreset,
	type PromptPresetDetail,
	type PromptPresetSummaryFields,
	type PromptPresetDataFields
} from '../services/promptPreset.js';
import { LorebookService, type Lorebook } from '../services/lorebook.js';
import { ScriptService, type Script } from '../services/script.js';
import { ModuleService, type Module } from '../services/module.js';
import { PluginService, type Plugin } from '../services/plugin.js';
import type { OrderedRef } from '../db/index.js';

// ══════════════════════════════════════════════════
// Level 1: Global State (always loaded)
// ══════════════════════════════════════════════════

export const appSettings = writable<AppSettings | null>(null);
export const characters = writable<Character[]>([]);
export const personas = writable<Persona[]>([]);
export const promptPresets = writable<PromptPreset[]>([]);

export async function loadGlobalState() {
	appSettings.set(await SettingsService.get());
	characters.set(await CharacterService.list());
	personas.set(await PersonaService.list());
	promptPresets.set(await PromptPresetService.list());
}

export async function updateSettings(changes: Partial<AppSettings>) {
	const current = get(appSettings) || ({} as AppSettings);
	const updated = { ...current, ...changes } as AppSettings;
	await SettingsService.update(updated);
	appSettings.set(updated);
}

// ─── Character CRUD ──────────────────────────────────────────────────

export async function createCharacter(
	name: string,
	shortDescription: string,
	systemPrompt: string,
	greetingMessage?: string
) {
	const detail = await CharacterService.create(
		{ name, shortDescription },
		{ systemPrompt, greetingMessage, chatRefs: [] }
	);

	// Add to settings' characterRefs
	const settings = get(appSettings);
	if (settings) {
		const refs = settings.characterRefs || [];
		refs.push({ id: detail.id, sortOrder: generateSortOrder(refs) });
		await updateSettings({ characterRefs: refs });
	}

	characters.set(await CharacterService.list());
	return detail;
}

export async function deleteCharacter(id: string) {
	await CharacterService.delete(id);

	// Remove from settings' characterRefs
	const settings = get(appSettings);
	if (settings) {
		const refs = (settings.characterRefs || []).filter(r => r.id !== id);
		await updateSettings({ characterRefs: refs });
	}

	characters.set(await CharacterService.list());
	if (get(activeCharacter)?.id === id) {
		clearActiveCharacter();
	}
}

// ─── Persona CRUD ────────────────────────────────────────────────────

export async function createPersona(
	fields: PersonaSummaryFields,
	data: PersonaDataFields
) {
	const persona = await PersonaService.create(fields, data);

	const settings = get(appSettings);
	if (settings) {
		const refs = settings.personaRefs || [];
		refs.push({ id: persona.id, sortOrder: generateSortOrder(refs) });
		await updateSettings({ personaRefs: refs });
	}

	personas.set(await PersonaService.list());
}

export async function updatePersonaSummary(id: string, changes: Partial<PersonaSummaryFields>) {
	await PersonaService.updateSummary(id, changes);
	personas.set(await PersonaService.list());
}

export async function updatePersonaData(id: string, changes: Partial<PersonaDataFields>) {
	await PersonaService.updateData(id, changes);
}

export async function deletePersona(id: string) {
	await PersonaService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		const refs = (settings.personaRefs || []).filter(r => r.id !== id);
		await updateSettings({ personaRefs: refs });
	}

	personas.set(await PersonaService.list());
}

// ─── Prompt Preset CRUD ──────────────────────────────────────────────

export const activePreset = writable<PromptPresetDetail | null>(null);

export async function selectPreset(id: string) {
	activePreset.set(await PromptPresetService.getDetail(id));
}

export async function createPreset(
	fields: PromptPresetSummaryFields,
	data?: PromptPresetDataFields
) {
	const detail = await PromptPresetService.create(fields, data);

	const settings = get(appSettings);
	if (settings) {
		const refs = settings.presetRefs || [];
		refs.push({ id: detail.id, sortOrder: generateSortOrder(refs) });
		await updateSettings({ presetRefs: refs });
	}

	promptPresets.set(await PromptPresetService.list());
	return detail;
}

export async function updatePresetSummary(id: string, changes: Partial<PromptPresetSummaryFields>) {
	await PromptPresetService.updateSummary(id, changes);
	promptPresets.set(await PromptPresetService.list());
	if (get(activePreset)?.id === id) {
		activePreset.set(await PromptPresetService.getDetail(id));
	}
}

export async function updatePresetData(id: string, changes: Partial<PromptPresetDataFields>) {
	await PromptPresetService.updateData(id, changes);
	if (get(activePreset)?.id === id) {
		activePreset.set(await PromptPresetService.getDetail(id));
	}
}

export async function deletePreset(id: string) {
	await PromptPresetService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		const refs = (settings.presetRefs || []).filter(r => r.id !== id);
		await updateSettings({ presetRefs: refs });
	}

	promptPresets.set(await PromptPresetService.list());
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
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
		// Fetch chats by IDs from character's chatRefs (ordered)
		const chatIds = (detail.data.chatRefs ?? []).map((r: OrderedRef) => r.id);
		const chats = await ChatService.getMany(chatIds);
		// Sort by chatRefs order
		const orderMap = new Map((detail.data.chatRefs ?? []).map((r: OrderedRef, i: number) => [r.id, i]));
		chats.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
		activeChats.set(chats);
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

	const chat = await ChatService.create(char.id, title);

	// Add to character's chatRefs
	const chatRefs = [...(char.data.chatRefs ?? []), { id: chat.id, sortOrder: generateSortOrder(char.data.chatRefs ?? []) }];
	await CharacterService.updateData(char.id, { chatRefs });

	// Refresh
	activeCharacter.set(await CharacterService.getDetail(char.id));
	const updatedChar = get(activeCharacter);
	if (updatedChar) {
		const chatIds = (updatedChar.data.chatRefs ?? []).map((r: OrderedRef) => r.id);
		activeChats.set(await ChatService.getMany(chatIds));
	}
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

	// Remove from character's chatRefs
	const char = get(activeCharacter);
	if (char) {
		const chatRefs = (char.data.chatRefs ?? []).filter((r: OrderedRef) => r.id !== chatId);
		await CharacterService.updateData(char.id, { chatRefs });
		activeCharacter.set(await CharacterService.getDetail(char.id));
	}

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

// Shared resources loaded for the active context
export const activeLorebooks = writable<Lorebook[]>([]);
export const activeScripts = writable<Script[]>([]);
export const activeModules = writable<Module[]>([]);
export const activePlugins = writable<Plugin[]>([]);

export async function selectChat(chatId: string) {
	const detail = await ChatService.getDetail(chatId);
	activeChat.set(detail);
	messages.set(detail ? await MessageService.listByChat(chatId) : []);

	// TODO: Load shared resources based on chat/character refs
	activeLorebooks.set([]);
	activeScripts.set([]);
	activeModules.set([]);
	activePlugins.set([]);
}

export function clearActiveChat() {
	activeChat.set(null);
	messages.set([]);
	activeLorebooks.set([]);
	activeScripts.set([]);
	activeModules.set([]);
	activePlugins.set([]);
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
		const chatIds = (char.data.chatRefs ?? []).map((r: OrderedRef) => r.id);
		const chats = await ChatService.getMany(chatIds);
		const orderMap = new Map((char.data.chatRefs ?? []).map((r: OrderedRef, i: number) => [r.id, i]));
		chats.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
		activeChats.set(chats);
	}
}

/** Generate a simple sort order key for appending to the end of a list */
function generateSortOrder(existingRefs: OrderedRef[]): string {
	if (existingRefs.length === 0) return 'a0';
	const lastOrder = existingRefs[existingRefs.length - 1].sortOrder;
	// Simple increment — proper fractional indexing can be swapped in later
	const num = parseInt(lastOrder.slice(1), 36) + 1;
	return 'a' + num.toString(36);
}
