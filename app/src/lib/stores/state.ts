/**
 * Centralized Store Declarations
 *
 * All writable/derived store instances live here to prevent circular imports.
 * Logic (functions) stays in per-domain files that import from this module.
 */

import { derived, writable } from 'svelte/store';
import type { AppSettings } from '../services/settings.js';
import type { Character, CharacterDetail } from '../services/character.js';
import type { Chat, ChatDetail } from '../services/chat.js';
import type { Message } from '../services/message.js';
import type { Persona } from '../services/persona.js';
import type { PromptPreset, PromptPresetDetail } from '../services/promptPreset.js';
import type { Module } from '../services/module.js';
import type { Plugin } from '../services/plugin.js';
import type { Lorebook } from '../services/lorebook.js';
import type { Script } from '../services/script.js';

// ─── Level 0 (Global Settings) ──────────────────────────────────────
export const appSettings = writable<AppSettings | null>(null);

// ─── Level 1 (Global Lists) ─────────────────────────────────────────
export const characters = writable<Character[]>([]);
export const personas = writable<Persona[]>([]);
export const promptPresets = writable<PromptPreset[]>([]);
export const modules = writable<Module[]>([]);
export const plugins = writable<Plugin[]>([]);

export const moduleResources = writable(
	new Map<
		string,
		{
			lorebooks: Lorebook[];
			scripts: Script[];
		}
	>()
);

// ─── Level 2 (Character Context) ────────────────────────────────────
export const activeCharacter = writable<CharacterDetail | null>(null);
export const characterLorebooks = writable<Lorebook[]>([]);
export const characterScripts = writable<Script[]>([]);
export const characterModules = writable<Module[]>([]);
export const chats = writable<Chat[]>([]);

// ─── Level 3 (Chat Context) ─────────────────────────────────────────
export const activeChat = writable<ChatDetail | null>(null);
export const chatLorebooks = writable<Lorebook[]>([]);
export const messages = writable<Message[]>([]);

// ─── Context Resources ─────────────────────────────────────────────────
export const activePreset = writable<PromptPresetDetail | null>(null);
export const activeLorebooks = writable<Lorebook[]>([]);
export const activeScripts = writable<Script[]>([]);

// ─── Derived Resources ─────────────────────────────────────────────────
export const activeCharacterId = derived(activeCharacter, (c) => c?.id);
export const hasActiveCharacter = derived(activeCharacter, (c) => !!c);

export const activeChatId = derived(activeChat, (c) => c?.id);
export const hasActiveChat = derived(activeChat, (c) => !!c);

export const activeModuleIds = derived([appSettings, activeCharacter], ([settings, char]) => {
	const ids = new Set<string>();
	for (const r of settings?.moduleRefs ?? []) {
		if (r.enabled) ids.add(r.id);
	}
	for (const r of char?.data.moduleRefs ?? []) {
		ids.add(r.id);
	}
	return ids;
});

export const allLorebooks = derived(
	[characterLorebooks, chatLorebooks, moduleResources, activeModuleIds],
	([charLB, chatLB, resMap, activeIds]) => {
		const modLB = [...activeIds].flatMap((id) => resMap.get(id)?.lorebooks ?? []);
		return [...modLB, ...charLB, ...chatLB];
	}
);

export const allScripts = derived(
	[characterScripts, moduleResources, activeModuleIds],
	([charSC, resMap, activeIds]) => {
		const modSC = [...activeIds].flatMap((id) => resMap.get(id)?.scripts ?? []);
		return [...modSC, ...charSC];
	}
);

export const activePersona = derived(
	[activeCharacter, personas],
	([char, list]) => list.find((p) => p.id === char?.data.personaId) ?? null
);
