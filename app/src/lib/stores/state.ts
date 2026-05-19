/**
 * Centralized Store Declarations
 *
 * All writable/derived store instances live here to prevent circular imports.
 * Logic (functions) stays in per-domain files that import from this module.
 */

import { derived, writable } from 'svelte/store';
import type {
    AppSettings,
    User,
    Character,
    Room,
    Chat,
    Message,
    Persona,
    Preset,
    Module,
    Plugin,
    Lorebook,
    Script,
    CharJS,
    MultiRoom,
    MultiRoomMember
} from '$lib/services';
import type { AssetSyncStatus, SyncStatus } from '$lib/services';
import type { DisplayMessage, ChatTask } from './types';
import { EntityStore } from './entity_store';
import { compareSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { EntityListConfig, AssetRef } from '$lib/types/refs';
import { normalizeAssetName, type AssetNameIndex } from '$lib/template/assets';

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
export const rooms = new EntityStore<Room>();
export const multiRooms = new EntityStore<Room>();
export const multiRoomMetas = new EntityStore<MultiRoom>({
    sortFn: (a, b) => b.updatedAt - a.updatedAt
});
export const multiRoomMembers = writable(new Map<string, MultiRoomMember[]>());
export const personas = new EntityStore<Persona>();
export const presets = new EntityStore<Preset>();
export const modules = new EntityStore<Module>();
export const plugins = new EntityStore<Plugin>();

export const activePreset = derived([appSettings, presets], ([$settings, $presets]) => {
    const id = $settings?.presetId;
    if (!id) return null;
    return $presets.find((p) => p.id === id) ?? null;
});

// ─── Level 2 (Room Context) ─────────────────────────────────────────
export const isMultiRoom = writable(false);
export const activeRoomId = writable<string | null>(null);
export const activeRoom = derived(
    [activeRoomId, rooms, multiRooms, isMultiRoom],
    ([id, , , multi]) => (id ? ((multi ? multiRooms.get(id) : rooms.get(id)) ?? null) : null)
);
export const hasActiveRoom = derived(activeRoomId, (id) => !!id);

export const multiRoomCharacters = new EntityStore<Character>();
export const multiRoomPersonas = new EntityStore<Persona>();

export const roomCharacters = derived(
    [activeRoom, characters, multiRoomCharacters, isMultiRoom],
    ([room, chars, multiChars, multi]) => {
        if (!room) return [];
        const source = multi ? multiChars : chars;
        const ids = new Set(
            Object.entries(room.characters.refs)
                .filter(([, ref]) => ref !== undefined)
                .map(([id]) => id)
        );
        return sortByRefs(
            source.filter((character) => ids.has(character.id)),
            room.characters.refs
        );
    }
);
export const roomChats = new EntityStore<Chat>();

// ─── Level 3 (Chat Context) ─────────────────────────────────────────
export const activeChatId = writable<string | null>(null);
export const activeChat = derived([activeChatId, roomChats], ([id]) =>
    id ? (roomChats.get(id) ?? null) : null
);
export const hasActiveChat = derived(activeChatId, (id) => !!id);

export const chatSelections = writable<{
    characterId?: string;
    personaId?: string;
} | null>(null);

export const chatLorebooks = new EntityStore<Lorebook>();
export const chatScripts = new EntityStore<Script>();
export const chatPersonas = derived(
    [activeChat, personas, multiRoomPersonas, isMultiRoom],
    ([chat, list, multiList, multi]) => {
        if (!chat) return [];
        const source = multi ? multiList : list;
        const ids = new Set(
            Object.entries(chat.personas.refs)
                .filter(([, ref]) => ref !== undefined)
                .map(([id]) => id)
        );
        return sortByRefs(
            source.filter((persona) => ids.has(persona.id)),
            chat.personas.refs
        );
    }
);

export const messages = new EntityStore<Message>({
    sortFn: (a, b) => compareSortOrder(a.sortOrder, b.sortOrder)
});
export const messageIndexes = writable(new Map<string, number>());

// ─── Character Studio Context───────────────────────────────────────
export const activeCharacterId = writable<string | null>(null);
export const activeCharacter = derived(
    [activeCharacterId, characters, multiRoomCharacters],
    ([id]) => (id ? (characters.get(id) ?? multiRoomCharacters.get(id) ?? null) : null)
);
export const hasActiveCharacter = derived(activeCharacterId, (id) => !!id);

export const characterLorebooks = new EntityStore<Lorebook>();
export const characterScripts = new EntityStore<Script>();
export const characterCharJS = new EntityStore<CharJS>();
export const characterModules = derived([activeCharacter, modules], ([character, list]) => {
    if (!character) return [];
    const ids = new Set(
        Object.entries(character.modules.refs)
            .filter(([, ref]) => ref !== undefined)
            .map(([id]) => id)
    );
    return sortByRefs(
        list.filter((module) => ids.has(module.id)),
        character.modules.refs
    );
});

// ─── Persona Studio Context─────────────────────────────────────────
export const activePersonaId = writable<string | null>(null);
export const activePersona = derived([activePersonaId, personas, multiRoomPersonas], ([id]) =>
    id ? (personas.get(id) ?? multiRoomPersonas.get(id) ?? null) : null
);
export const hasActivePersona = derived(activePersonaId, (id) => !!id);

// ─── Module Editing Context ──────────────────────────────────────────
export const activeModuleId = writable<string | null>(null);
export const activeModule = derived([activeModuleId, modules], ([id]) =>
    id ? (modules.get(id) ?? null) : null
);
export const hasActiveModule = derived(activeModuleId, (id) => !!id);

export const moduleLorebooks = new EntityStore<Lorebook>();
export const moduleScripts = new EntityStore<Script>();
export const moduleCharJS = new EntityStore<CharJS>();

// ─── Selected Preset Context ──────────────────────────────────────────
export const presetScripts = new EntityStore<Script>();

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

// ─── Asset Helper & Derived Store ─────────────────────────────────────

/**
 * Derived store mapping: Map<OwnerId, Map<NormalizedName, string[]>>
 * Merges asset refs from active modules, room characters, and chat personas.
 */
export const chatAssetsMap = derived(
    [modules, roomCharacters, chatPersonas],
    ([$modules, $roomCharacters, $chatPersonas]): AssetNameIndex => {
        const resolverMap: AssetNameIndex = new Map();

        const addEntityAssets = (ownerId: string, assetsConfig?: EntityListConfig<AssetRef>) => {
            if (!assetsConfig?.refs) return;
            const ownerMap = new Map<string, string[]>();
            for (const ref of Object.values(assetsConfig.refs)) {
                if (ref?.name && ref?.id) {
                    const normalized = normalizeAssetName(ref.name);
                    if (normalized) {
                        const list = ownerMap.get(normalized) ?? [];
                        list.push(ref.id);
                        ownerMap.set(normalized, list);
                    }
                }
            }
            if (ownerMap.size > 0) {
                resolverMap.set(ownerId, ownerMap);
            }
        };

        for (const module of $modules) addEntityAssets(module.id, module.assets);
        for (const char of $roomCharacters) addEntityAssets(char.id, char.assets);
        for (const persona of $chatPersonas) addEntityAssets(persona.id, persona.assets);

        return resolverMap;
    }
);
