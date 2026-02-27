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
import type { Lorebook, Script, Module, Plugin } from '../services';
import type { OrderedRef } from '../db/index.js';
import { generateKeyBetween } from 'fractional-indexing';

// ══════════════════════════════════════════════════
// Level 1: Global State (always loaded)
// ══════════════════════════════════════════════════

export const appSettings = writable<AppSettings | null>(null);
export const characters = writable<Character[]>([]);
export const personas = writable<Persona[]>([]);
export const promptPresets = writable<PromptPreset[]>([]);

export async function loadGlobalState() {
	const [settings, charList, personaList, presetList] = await Promise.all([
		SettingsService.get(),
		CharacterService.list(),
		PersonaService.list(),
		PromptPresetService.list()
	]);
	appSettings.set(settings);
	characters.set(charList);
	personas.set(personaList);
	promptPresets.set(presetList);
}

export async function updateSettings(changes: Partial<AppSettings>) {
	const current = get(appSettings) || ({} as AppSettings);
	const updated = { ...current, ...changes } as AppSettings;
	appSettings.set(updated);
	await SettingsService.update(updated);
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

	const { data: _data, ...summary } = detail;
	characters.update((list) => [...list, summary as Character]);

	// Add to settings' characterRefs
	const settings = get(appSettings);
	if (settings) {
		const existing = settings.characterRefs || [];
		await updateSettings({
			characterRefs: [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }]
		});
	}

	return detail;
}

export async function deleteCharacter(id: string) {
	await CharacterService.delete(id);

	// Remove from settings' characterRefs
	const settings = get(appSettings);
	if (settings) {
		await updateSettings({
			characterRefs: (settings.characterRefs || []).filter((r) => r.id !== id)
		});
	}

	characters.update((list) => list.filter((c) => c.id !== id));
	if (get(activeCharacter)?.id === id) {
		clearActiveCharacter();
	}
}

// ─── Persona CRUD ────────────────────────────────────────────────────

export async function createPersona(fields: PersonaSummaryFields, data: PersonaDataFields) {
	const detail = await PersonaService.create(fields, data);

	const { data: _data, ...summary } = detail;
	personas.update((list) => [...list, summary as Persona]);

	const settings = get(appSettings);
	if (settings) {
		const existing = settings.personaRefs || [];
		await updateSettings({
			personaRefs: [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }]
		});
	}

	return detail;
}

export async function updatePersonaSummary(id: string, changes: Partial<PersonaSummaryFields>) {
	const updated = await PersonaService.updateSummary(id, changes);
	if (updated) {
		personas.update((list) => list.map((p) => (p.id === id ? updated : p)));
	}
}

export async function updatePersonaData(id: string, changes: Partial<PersonaDataFields>) {
	await PersonaService.updateData(id, changes);
}

export async function deletePersona(id: string) {
	await PersonaService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		await updateSettings({
			personaRefs: (settings.personaRefs || []).filter((r) => r.id !== id)
		});
	}

	personas.update((list) => list.filter((p) => p.id !== id));
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

	const { data: _data, ...summary } = detail;
	promptPresets.update((list) => [...list, summary as PromptPreset]);

	const settings = get(appSettings);
	if (settings) {
		const existing = settings.presetRefs || [];
		await updateSettings({
			presetRefs: [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }]
		});
	}

	return detail;
}

export async function updatePresetSummary(id: string, changes: Partial<PromptPresetSummaryFields>) {
	const updated = await PromptPresetService.updateSummary(id, changes);
	if (updated) {
		promptPresets.update((list) => list.map((p) => (p.id === id ? updated : p)));
		activePreset.update((p) => (p && p.id === id ? { ...p, ...updated } : p));
	}
}

export async function updatePresetData(id: string, changes: Partial<PromptPresetDataFields>) {
	const result = await PromptPresetService.updateData(id, changes);
	if (result) {
		activePreset.update((p) => (p && p.id === id ? { ...p, data: { ...p.data, ...changes }, updatedAt: result.updatedAt } : p));
	}
}

export async function deletePreset(id: string) {
	await PromptPresetService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		await updateSettings({
			presetRefs: (settings.presetRefs || []).filter((r) => r.id !== id)
		});
	}

	promptPresets.update((list) => list.filter((p) => p.id !== id));
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
		const chatIds = (detail.data.chatRefs ?? []).map((r: OrderedRef) => r.id);
		const chats = await ChatService.getMany(chatIds);
		activeChats.set(sortChatsByRefs(chats, detail.data.chatRefs ?? []));
	}
}

export function clearActiveCharacter() {
	activeCharacter.set(null);
	activeChats.set([]);
	clearActiveChat();
}

export async function updateCharacterSummary(id: string, changes: Partial<CharacterSummaryFields>) {
	const updated = await CharacterService.updateSummary(id, changes);
	if (updated) {
		characters.update((list) => list.map((c) => (c.id === id ? updated : c)));
		activeCharacter.update((c) => (c && c.id === id ? { ...c, ...updated } : c));
	}
}

export async function updateCharacterData(id: string, changes: Partial<CharacterDataFields>) {
	const result = await CharacterService.updateData(id, changes);
	if (result) {
		activeCharacter.update((c) => (c && c.id === id ? { ...c, data: { ...c.data, ...changes }, updatedAt: result.updatedAt } : c));
	}
}

// Character-level actions

export async function createChat(title: string) {
	const char = get(activeCharacter);
	if (!char) return;

	const chat = await ChatService.create(char.id, title);

	// Build updated chatRefs
	const existing = char.data.chatRefs ?? [];
	const chatRefs: OrderedRef[] = [
		...existing,
		{ id: chat.id, sortOrder: generateSortOrder(existing) }
	];
	await CharacterService.updateData(char.id, { chatRefs });

	activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, chatRefs } } : c));
	activeChats.update((list) => [...list, chat]);
	return chat;
}

export async function updateChat(chatId: string, changes: Partial<ChatSummaryFields>) {
	const updated = await ChatService.updateSummary(chatId, changes);
	if (updated) {
		activeChats.update((list) => list.map((c) => (c.id === chatId ? updated : c)));
		activeChat.update((c) => (c && c.id === chatId ? { ...c, ...updated } : c));
	}
}

export async function updateChatData(chatId: string, changes: Partial<ChatDataFields>) {
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
		activeChats.update((list) => list.filter((c) => c.id !== chatId));
	}

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

	const preview = content.substring(0, 50);

	// Parallelise: message creation and chat preview update are independent
	const [newMessage, updatedChat] = await Promise.all([
		MessageService.create(chat.id, { role, content }),
		ChatService.updateSummary(chat.id, { lastMessagePreview: preview })
	]);

	messages.update((prev) => [...prev, newMessage]);
	if (updatedChat) {
		activeChats.update((list) =>
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
			activeChats.update((list) =>
				list.map((c) => (c.id === chat.id ? updatedChat : c))
			);
			activeChat.update((c) => (c ? { ...c, ...updatedChat } : c));
		}
	}
}

export async function deleteMessage(msgId: string) {
	await MessageService.delete(msgId);
	messages.update((list) => list.filter((m) => m.id !== msgId));
}

// ─── Internal ────────────────────────────────────────────────────────

/**
 * Sort a chat list to match the order defined by an OrderedRef array.
 * Extracted to avoid duplication between selectCharacter and former refreshActiveChats.
 */
function sortChatsByRefs(chats: Chat[], refs: OrderedRef[]): Chat[] {
	const orderMap = new Map(refs.map((r, i) => [r.id, i]));
	return [...chats].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}

/** Generate a fractional sort order key for appending to the end of a list */
export function generateSortOrder(existingRefs: OrderedRef[]): string {
	if (existingRefs.length === 0) return generateKeyBetween(null, null);
	const lastOrder = existingRefs[existingRefs.length - 1].sortOrder;
	return generateKeyBetween(lastOrder, null);
}

/** Helper for drag-and-drop to reorder between two existing keys (null means start/end) */
export function reorderKeyBetween(prevKey: string | null, nextKey: string | null): string {
	return generateKeyBetween(prevKey, nextKey);
}
