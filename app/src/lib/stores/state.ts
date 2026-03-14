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
import type { AssetSyncStatus, SyncStatus } from '$lib/services';
import type { DisplayMessage, ChatTask } from './types';

// ─── Level 0 (Global Settings & User Profile) ──────────────────────
export const appSettings = writable<AppSettings | null>(null);
export const activeUser = writable<Profile | null>(null);

/** Tracks whether the PocketBase auth token is valid. */
export const pbConnected = writable<boolean>(false);
export const dataSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const profileSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const assetSyncStatus = writable<AssetSyncStatus>({ state: 'idle', pendingCount: 0 });

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
export const chatScripts = writable<Script[]>([]);
export const messages = writable<Message[]>([]);

// ─── Runtime States (Ephemeral — not persisted to DB) ─────────────────
/**
 * chatTasks: keyed by chatId.
 * Managed by chatTask store logic.
 */
export const chatTasks = writable<Map<string, ChatTask>>(new Map());

/** True when the currently active chat has an in-flight task. */
export const isChatRunning = derived([chatTasks, activeChat], ([tasks, chat]) =>
	chat ? tasks.has(chat.id) : false
);

/**
 * Single merged array of confirmed DB messages + active generation task.
 * UI components iterate this one list — no streaming/normal branching needed.
 */
export const displayMessages = derived(
	[messages, chatTasks, activeChat],
	([msgs, tasks, chat]): DisplayMessage[] => {
		// Map confirmed messages
		const base: DisplayMessage[] = msgs.map((msg) => ({
			...msg,
			displayStatus: 'completed' as const
		}));

		// Append active generation task as a virtual message at the end
		if (chat) {
			const task = tasks.get(chat.id);
			if (task) {
				base.push({
					id: `__generating_${chat.id}`,
					chatId: chat.id,
					sortOrder: '\uffff', // Always sorts last
					role: 'char',
					content: task.content,
					thought: task.thought,
					toolCalls: task.toolCalls?.map((tc, i) => ({
						id: `__generating_toolcall_${chat.id}_${i}`,
						name: tc.name,
						status: 'pending' as const
					})),
					displayStatus: task.status,
					errorMessage: task.errorMessage
				});
			}
		}

		return base;
	}
);

// ─── Context Resources ─────────────────────────────────────────────────
// Module IDs: globally enabled OR character-referenced
export const activeModuleIds = derived([appSettings, activeCharacter], ([settings, char]) => {
	const globalEnabledIds = new Set(
		settings?.moduleRefs?.filter((r) => r.enabled).map((r) => r.id) ?? []
	);
	const charModuleIds = char?.data.moduleRefs?.map((r) => r.id) ?? [];

	// Union: globally enabled OR character-referenced
	const allIds = new Set([...globalEnabledIds, ...charModuleIds]);
	return Array.from(allIds);
});

// Merged from modules + character + chat
export const activeLorebooks = derived(
	[moduleResources, activeModuleIds, characterLorebooks, chatLorebooks],
	([resources, activeIds, charLorebooks, chatLorebooks]) => {
		// Get lorebooks from active modules
		const moduleLorebooks = activeIds.flatMap((id) => resources.get(id)?.lorebooks ?? []);

		// Merge all: modules + character + chat
		return [...moduleLorebooks, ...charLorebooks, ...chatLorebooks];
	}
);

// Merged from modules + character + chat
export const activeScripts = derived(
	[moduleResources, activeModuleIds, characterScripts, chatScripts],
	([resources, activeIds, charScripts, chatScripts]) => {
		// Get scripts from active modules
		const moduleScripts = activeIds.flatMap((id) => resources.get(id)?.scripts ?? []);

		// Merge all: modules + character + chat
		return [...moduleScripts, ...charScripts, ...chatScripts];
	}
);

// Active preset from app settings. Managed by preset store logic.
export const activePreset = writable<PresetDetail | null>(null);

// ─── Derived Resources ─────────────────────────────────────────────────
export const activeCharacterId = derived(activeCharacter, (c) => c?.id);
export const hasActiveCharacter = derived(activeCharacter, (c) => !!c);

export const activeChatId = derived(activeChat, (c) => c?.id);
export const hasActiveChat = derived(activeChat, (c) => !!c);

export const activePersona = derived(
	[activeCharacter, personas],
	([char, list]) => list.find((p) => p.id === char?.data.personaId) ?? null
);
