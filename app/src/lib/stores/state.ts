/**
 * Centralized Store Declarations
 *
 * All writable/derived store instances live here to prevent circular imports.
 * Logic (functions) stays in per-domain files that import from this module.
 */

import { derived, writable, type Readable } from 'svelte/store';
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

/**
 * Normalized message cache for the active chat.
 * Keyed by message id — O(1) lookup.
 * Use the `messages` derived store for UI rendering (sorted by sortOrder).
 */
export const messageMap = writable<Map<string, Message>>(new Map());

/**
 * Sorted-by-sortOrder view of messageMap. Read-only for UI consumption.
 * Recomputed only when messageMap changes.
 */
export const messages: Readable<Message[]> = derived(messageMap, ($map) =>
	Array.from($map.values()).sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
);

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
 *
 * - New generation (task.targetMessageId is undefined):
 *   Appends a virtual message at the end (existing behaviour).
 *
 * - Reroll (task.targetMessageId is set):
 *   Overlays a virtual MessageSwipe onto the target message's swipes array,
 *   pointing activeSwipeIndex at it. The message count stays the same.
 *   On error / dismiss the task is cleared and the message reverts cleanly.
 *
 * UI components iterate this one list — no streaming/normal branching needed.
 */
export const displayMessages = derived(
	[messages, chatTasks, activeChat],
	([msgs, tasks, chat]): DisplayMessage[] => {
		const task = chat ? tasks.get(chat.id) : undefined;

		const base: DisplayMessage[] = msgs.map((msg): DisplayMessage => {
			// ── Reroll target: overlay a virtual swipe on the existing message ──
			if (task?.targetMessageId === msg.id) {
				const streamingSwipe = {
					content: task.content,
					thought: task.thought,
					toolCalls: task.toolCalls?.map((tc, i) => ({
						id: `__generating_toolcall_${chat!.id}_${i}`,
						name: tc.name,
						status: 'pending' as const
					})),
					createdAt: Date.now()
				};
				return {
					...msg,
					swipes: [...msg.swipes, streamingSwipe],
					activeSwipeIndex: msg.swipes.length, // points at the new virtual swipe
					displayStatus: task.status,
					errorMessage: task.errorMessage
				};
			}
			// ── Normal confirmed message ──
			return { ...msg, displayStatus: 'completed' as const };
		});

		// ── New generation (no target): append a virtual message at the end ──
		if (chat && task && !task.targetMessageId) {
			base.push({
				id: `__generating_${chat.id}`,
				chatId: chat.id,
				sortOrder: '\uffff',
				role: 'char',
				swipes: [
					{
						content: task.content,
						thought: task.thought,
						toolCalls: task.toolCalls?.map((tc, i) => ({
							id: `__generating_toolcall_${chat.id}_${i}`,
							name: tc.name,
							status: 'pending' as const
						})),
						createdAt: Date.now()
					}
				],
				activeSwipeIndex: 0,
				displayStatus: task.status,
				errorMessage: task.errorMessage
			});
		}

		return base;
	}
);

// ─── Context Resources ─────────────────────────────────────────────────
// Active preset from app settings. Managed by preset store logic.
export const activePreset = writable<PresetDetail | null>(null);
export const activePersona = writable<Persona | null>(null);

// ─── Derived Resources ─────────────────────────────────────────────────
export const activeCharacterId = derived(activeCharacter, (c) => c?.id);
export const hasActiveCharacter = derived(activeCharacter, (c) => !!c);

export const activeChatId = derived(activeChat, (c) => c?.id);
export const hasActiveChat = derived(activeChat, (c) => !!c);
