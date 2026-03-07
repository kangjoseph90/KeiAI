/**
 * Centralized Store Declarations
 *
 * All writable/derived store instances live here to prevent circular imports.
 * Logic (functions) stays in per-domain files that import from this module.
 */

import { derived, writable } from 'svelte/store';
import type {
	AppSettings,
	Profile,
	Character,
	CharacterDetail,
	Chat,
	ChatDetail,
	Message,
	Persona,
	Preset,
	PresetDetail,
	Module,
	Plugin,
	Lorebook,
	Script
} from '$lib/services';
import type { GenerationTask, DisplayMessage } from './types';

// ─── Level 0 (Global Settings & User Profile) ──────────────────────
export const appSettings = writable<AppSettings | null>(null);
export const activeUser = writable<Profile | null>(null);

/** Tracks whether the PocketBase auth token is valid. */
export const pbConnected = writable<boolean>(false);

// ─── Derived Auth State ──────────────────────────────────────────────
export const isLoggedIn = derived(
	[activeUser, pbConnected],
	([user, connected]) => user !== null && !user.isGuest && connected
);
export const userEmail = derived(activeUser, (u) => u?.email ?? null);
export const userId = derived(activeUser, (u) => u?.id ?? null);
export const isGuest = derived(activeUser, (u) => u?.isGuest ?? true);

// ─── Level 1 (Global Lists) ─────────────────────────────────────────
export const characters = writable<Character[]>([]);
export const personas = writable<Persona[]>([]);
export const presets = writable<Preset[]>([]);
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

// ─── Generation State (Ephemeral — not persisted to DB) ─────────────

/** Active LLM generation tasks, keyed by chatId. Ephemeral UI-only state. */
export const generationTasks = writable<Map<string, GenerationTask>>(new Map());

/** Whether any generation is running in the active chat */
export const isGenerating = derived([generationTasks, activeChat], ([tasks, chat]) =>
	chat ? tasks.has(chat.id) : false
);

/**
 * Single merged array of confirmed DB messages + active generation task.
 * UI components iterate this one list — no streaming/normal branching needed.
 */
export const displayMessages = derived(
	[messages, generationTasks, activeChat],
	([msgs, tasks, chat]): DisplayMessage[] => {
		// Map confirmed messages
		const base: DisplayMessage[] = msgs.map((msg) => ({
			...msg,
			displayStatus: 'completed' as const
		}));

		// Append active generation task as a virtual message at the end
		if (chat && tasks.has(chat.id)) {
			const task = tasks.get(chat.id)!;
			base.push({
				id: `__generating_${chat.id}`,
				chatId: chat.id,
				sortOrder: '\uffff', // Always sorts last
				role: 'char',
				content: task.content,
				displayStatus: task.status,
				errorMessage: task.errorMessage
			});
		}

		return base;
	}
);

// ─── Context Resources ─────────────────────────────────────────────────
export const activePreset = writable<PresetDetail | null>(null);
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
