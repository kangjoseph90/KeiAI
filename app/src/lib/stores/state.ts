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
import type { SyncStatus } from '$lib/services';
import type {
    ChatDraft,
    CollectedTask,
    CollectedTaskKind,
    DictationTask,
    DisplayMessage,
    ChatTask,
    InputTranslationTask,
    MediaTask,
    SuggestionTask,
    TaskMetadata,
    TitleTask,
    TranslationTask,
    RecordAudioTask
} from './types';
import { EntityStore } from './entity_store';
import { compareSortOrder, listItems, sortByRefs } from '$lib/utils/ordering';
import type { EntityListConfig, AssetRef } from '$lib/types/refs';
import { normalizeAssetName, type AssetNameIndex } from '$lib/template/display';
import type { AssetReadLocator } from '$lib/services/asset';
import type { DataScopeType, TableName } from '$lib/adapters/db';
import type { ConnectionChangeProgress } from '$lib/services';
import type { ThemePreference } from './theme';

// ─── Level 0 (Global Settings & User Profile) ──────────────────────
export const appSettings = writable<AppSettings | null>(null);
export const themePreference = writable<ThemePreference>('system');
export const activeUser = writable<User | null>(null);
export const localUsers = writable<User[]>([]);

/** Tracks whether the PocketBase auth token is valid. */
export const pbConnected = writable<boolean>(false);
export const dataSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const userSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const multiSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const assetSyncStatus = writable<SyncStatus>({ state: 'idle' });
export const serverTransitionLocked = writable(false);
export const serverTransitionProgress = writable<ConnectionChangeProgress | null>(null);

// ─── Derived Auth State ──────────────────────────────────────────────
export const isLoggedIn = derived(
    [activeUser, pbConnected],
    ([user, connected]) => Boolean(user?.username) && connected
);
export const userEmail = derived(activeUser, (u) => u?.email ?? null);
export const username = derived(activeUser, (u) => u?.username ?? null);
export const userId = derived(activeUser, (u) => u?.id ?? null);
export const isCustomServer = derived(
    activeUser,
    (user) => user?.connections.server.mode === 'custom'
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

// ─── Runtime States (Ephemeral — not persisted to DB) ─────────────────
/**
 * chatTasks: keyed by chatId.
 * Managed by chatTask store logic.
 */
export const chatTasks = writable<Map<string, ChatTask>>(new Map());
export const translationTasks = writable<Map<string, TranslationTask>>(new Map());
export const imageGenerationTasks = writable<Map<string, MediaTask>>(new Map());
export const ttsTasks = writable<Map<string, MediaTask>>(new Map());
export const inputTranslationTasks = writable<Map<string, InputTranslationTask>>(new Map());
export const suggestionTasks = writable<Map<string, SuggestionTask>>(new Map());
export const titleTasks = writable<Map<string, TitleTask>>(new Map());
export const dictationTasks = writable<Map<string, DictationTask>>(new Map());
export const recordAudioTasks = writable<Map<string, RecordAudioTask>>(new Map());
export const chatDrafts = writable<Map<string, ChatDraft>>(new Map());

export const hasActiveRecording = derived(
    [dictationTasks, recordAudioTasks],
    ([dictations, audio]) =>
        [...dictations.values(), ...audio.values()].some(
            (task) => task.status === 'generating' && task.phase === 'recording'
        )
);

/** True when the currently active chat has an in-flight task. */
export const isChatRunning = derived([chatTasks, activeChat], ([tasks, chat]) =>
    chat ? tasks.get(chat.id)?.status === 'generating' : false
);

export const collectedTasks = derived(
    [
        chatTasks,
        translationTasks,
        imageGenerationTasks,
        ttsTasks,
        inputTranslationTasks,
        suggestionTasks,
        titleTasks,
        dictationTasks,
        recordAudioTasks
    ],
    ([
        chats,
        translations,
        images,
        speech,
        inputTranslations,
        suggestions,
        titles,
        dictations,
        audioRecordings
    ]): CollectedTask[] => [
        ...collectTasks('chat', chats),
        ...collectTasks('translation', translations),
        ...collectTasks('image', images),
        ...collectTasks('tts', speech),
        ...collectTasks('input_translation', inputTranslations),
        ...collectTasks('suggestion', suggestions),
        ...collectTasks('title', titles),
        ...collectTasks('dictation', dictations),
        ...collectTasks('record_audio', audioRecordings)
    ]
);

function collectTasks<T extends { status: 'generating' | 'completed' | 'error' } & TaskMetadata>(
    kind: CollectedTaskKind,
    tasks: Map<string, T>
): CollectedTask[] {
    return Array.from(tasks, ([taskKey, task]) => ({
        id: `${kind}:${taskKey}`,
        kind,
        taskKey,
        roomId: task.roomId,
        chatId: task.chatId,
        chatTitle: task.chatTitle,
        title: task.title,
        status: task.status === 'generating' ? 'running' : task.status,
        phase: 'phase' in task && typeof task.phase === 'string' ? task.phase : undefined,
        errorMessage:
            'errorMessage' in task && typeof task.errorMessage === 'string'
                ? task.errorMessage
                : undefined,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt
    }));
}

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
                    displayStatus: task.status === 'generating' ? 'generating' : task.status,
                    errorMessage: task.errorMessage
                };
            }
            return { ...base, displayStatus: 'completed' as const };
        });
    }
);

// ─── Asset Helper & Derived Store ─────────────────────────────────────

/**
 * Derived store mapping: Map<OwnerId, Map<NormalizedName, AssetReadLocator[]>>
 * Merges asset refs from active modules, room characters, and chat personas.
 */
export const chatAssetsMap = derived(
    [modules, roomCharacters, chatPersonas, userId],
    ([$modules, $roomCharacters, $chatPersonas, $userId]): AssetNameIndex => {
        const resolverMap: AssetNameIndex = new Map();

        const addEntityAssets = (
            scopeType: DataScopeType,
            scopeId: string,
            ownerTable: TableName,
            ownerId: string,
            assetsConfig?: EntityListConfig<AssetRef>
        ) => {
            if (!assetsConfig?.refs) return;
            const ownerMap = new Map<string, AssetReadLocator[]>();
            for (const ref of listItems(assetsConfig)) {
                if (ref?.name && ref?.hash && ref?.encKey) {
                    const normalized = normalizeAssetName(ref.name);
                    if (normalized) {
                        const list = ownerMap.get(normalized) ?? [];
                        list.push({
                            scopeType,
                            scopeId,
                            ownerTable,
                            ownerId,
                            hash: ref.hash,
                            encKey: ref.encKey,
                            mimeType: ref.mimeType,
                            width: ref.width,
                            height: ref.height
                        });
                        ownerMap.set(normalized, list);
                    }
                }
            }
            if (ownerMap.size > 0) {
                resolverMap.set(ownerId, ownerMap);
            }
        };

        for (const module of $modules) {
            addEntityAssets('user', $userId ?? '', 'modules', module.id, module.assets);
        }
        for (const char of $roomCharacters) {
            addEntityAssets(char.scopeType, char.scopeId, 'characters', char.id, char.assets);
        }
        for (const persona of $chatPersonas) {
            addEntityAssets(
                persona.scopeType,
                persona.scopeId,
                'personas',
                persona.id,
                persona.assets
            );
        }

        return resolverMap;
    }
);
