/**
 * Centralized Store Declarations
 *
 * All writable/derived store instances live here to prevent circular imports.
 * Logic (functions) stays in per-domain files that import from this module.
 */

import { derived, writable, type Readable } from 'svelte/store';
import type {
    AppSettings,
    User,
    Character,
    Chat,
    Message,
    Persona,
    Preset,
    Module,
    Plugin,
    Lorebook,
    Script,
    CharJS
} from '$lib/services';
import type { AssetSyncStatus, SyncStatus } from '$lib/services';
import type { DisplayMessage, ChatTask } from './types';
import { EntityStore } from './entity_store';

// ─── Level 0 (Global Settings & User Profile) ──────────────────────
export const appSettings = writable<AppSettings | null>(null);
export const activeUser = writable<User | null>(null);

/** Tracks whether the PocketBase auth token is valid. */
export const pbConnected = writable<boolean>(false);
export const dataSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const userSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const assetSyncStatus = writable<AssetSyncStatus>({ state: 'idle', pendingCount: 0 });

// ─── Derived Auth State ──────────────────────────────────────────────
export const isLoggedIn = derived(
    [activeUser, pbConnected],
    ([user, connected]) => user !== null && connected
);
export const userEmail = derived(activeUser, (u) => u?.email ?? null);
export const username = derived(activeUser, (u) => u?.username ?? null);
export const userId = derived(activeUser, (u) => u?.id ?? null);
export const isSyncServerConfigured = derived(activeUser, (u) => u?.selfHostUrl !== undefined);
export const isLocalOnly = derived(
    [activeUser, pbConnected],
    ([user, connected]) => user !== null && !connected
);
export const isSyncLinked = derived(
    [activeUser, pbConnected],
    ([user, connected]) => user !== null && connected
);

// ─── Level 1 (Global Lists) ─────────────────────────────────────────
export const characters = new EntityStore<Character>();
export const personas = new EntityStore<Persona>();
export const presets = new EntityStore<Preset>();
export const modules = new EntityStore<Module>();
export const plugins = new EntityStore<Plugin>();

export const activePreset = derived([appSettings, presets], ([$settings, $presets]) => {
    const id = $settings?.presetId;
    if (!id) return null;
    return $presets.find((p) => p.id === id) ?? null;
});

export const activePersona = derived([appSettings, personas], ([$settings, $personas]) => {
    const id = $settings?.personaId;
    if (!id) return null;
    return $personas.find((p) => p.id === id) ?? null;
});

export interface ModuleResourceEntry {
    lorebooks: EntityStore<Lorebook>;
    scripts: EntityStore<Script>;
    charjs: EntityStore<CharJS>;
}

export interface PresetResourceEntry {
    scripts: EntityStore<Script>;
}

export const moduleResources = writable(new Map<string, ModuleResourceEntry>());
export const presetResources = writable(new Map<string, PresetResourceEntry>());

// ─── Level 2 (Character Context) ────────────────────────────────────
export const activeCharacter = writable<Character | null>(null);
export const activeCharacterId = derived(activeCharacter, (c) => c?.id);
export const hasActiveCharacter = derived(activeCharacter, (c) => !!c);

export const characterLorebooks = new EntityStore<Lorebook>();
export const characterScripts = new EntityStore<Script>();
export const characterCharJS = new EntityStore<CharJS>();
export const characterModules = new EntityStore<Module>();
export const chats = new EntityStore<Chat>();

// ─── Level 3 (Chat Context) ─────────────────────────────────────────
export const activeChat = writable<Chat | null>(null);
export const activeChatId = derived(activeChat, (c) => c?.id);
export const hasActiveChat = derived(activeChat, (c) => !!c);

export const chatLorebooks = new EntityStore<Lorebook>();
export const chatScripts = new EntityStore<Script>();

export const messages = new EntityStore<Message>({
    sortFn: (a, b) => a.sortOrder.localeCompare(b.sortOrder)
});
export const messageIndexes = writable(new Map<string, number>());

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
 * Messages with display status overlay.
 * Generating/error messages already exist in DB — this just marks them.
 */
export const displayMessages = derived(
    [messages, chatTasks, activeChat, messageIndexes],
    ([msgs, tasks, chat, indexes]): DisplayMessage[] => {
        const task = chat ? tasks.get(chat.id) : undefined;

        return msgs.map((msg): DisplayMessage => {
            const messageIndex = indexes.get(msg.id);
            const base = { ...msg, messageIndex };

            if (task?.messageId === msg.id) {
                return {
                    ...base,
                    displayStatus: task.status,
                    errorMessage: task.errorMessage
                };
            }
            return { ...base, displayStatus: 'completed' as const };
        });
    }
);
