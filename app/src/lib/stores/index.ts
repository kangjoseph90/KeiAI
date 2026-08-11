/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    rooms, characters, personas, presets, modules, plugins, appSettings
 * Level 2 (Room):      activeRoom (detail), roomCharacters, roomChats — loaded on select
 * Level 3 (Chat):      activeChat (detail), messages, chatPersonas — loaded on enter
 *
 * Relationship patterns:
 *   Parent-owned 1:N: Parent's blob holds items and ordering metadata
 *   N:M (consumer→resource): Consumer's blob holds ordered refs, optionally with context state
 *   Exception: messages use chatId FK + createdAt ordering
 *
 * Leaving a layer clears its plaintext from memory.
 * Cross-service orchestration lives here, not inside services.
 *
 * UI components import from this barrel — all writable stores are
 * wrapped in readonly() so the UI can only subscribe, never .set()/.update().
 * Store logic files import writables directly from state.ts.
 */
import { readonly } from 'svelte/store';

// ─── Re-export writable stores as readonly ──────────────────────────
import * as StoreState from './state';

export const appSettings = readonly(StoreState.appSettings);
export const themePreference = readonly(StoreState.themePreference);
export const activeUser = readonly(StoreState.activeUser);
export const localUsers = readonly(StoreState.localUsers);
export const pbConnected = readonly(StoreState.pbConnected);
export const dataSyncStatus = readonly(StoreState.dataSyncStatus);
export const userSyncStatus = readonly(StoreState.userSyncStatus);
export const multiSyncStatus = readonly(StoreState.multiSyncStatus);
export const assetSyncStatus = readonly(StoreState.assetSyncStatus);
export const serverTransitionLocked = readonly(StoreState.serverTransitionLocked);
export const serverTransitionProgress = readonly(StoreState.serverTransitionProgress);
export const characters = readonly(StoreState.characters);
export const rooms = readonly(StoreState.rooms);
export const multiRooms = readonly(StoreState.multiRooms);
export const multiRoomMetas = readonly(StoreState.multiRoomMetas);
export const multiRoomMembers = readonly(StoreState.multiRoomMembers);
export const personas = readonly(StoreState.personas);
export const presets = readonly(StoreState.presets);
export const modules = readonly(StoreState.modules);
export const plugins = readonly(StoreState.plugins);
export const activeModule = readonly(StoreState.activeModule);
export const activeModuleId = readonly(StoreState.activeModuleId);
export const activeCharacter = readonly(StoreState.activeCharacter);
export const activeCharacterId = readonly(StoreState.activeCharacterId);
export const activePersona = readonly(StoreState.activePersona);
export const activePersonaId = readonly(StoreState.activePersonaId);
export const activeRoom = readonly(StoreState.activeRoom);
export const activeRoomId = readonly(StoreState.activeRoomId);
export const isMultiRoom = readonly(StoreState.isMultiRoom);
export const roomCharacters = readonly(StoreState.roomCharacters);
export const multiRoomCharacters = readonly(StoreState.multiRoomCharacters);
export const multiRoomPersonas = readonly(StoreState.multiRoomPersonas);
export const roomChats = readonly(StoreState.roomChats);
export const activeChat = readonly(StoreState.activeChat);
export const activeChatId = readonly(StoreState.activeChatId);
export const chatSelections = readonly(StoreState.chatSelections);
export const chatPersonas = readonly(StoreState.chatPersonas);
export const messages = readonly(StoreState.messages);
export const chatTasks = readonly(StoreState.chatTasks);
export const commandTasks = readonly(StoreState.commandTasks);
export const translationTasks = readonly(StoreState.translationTasks);
export const imageGenerationTasks = readonly(StoreState.imageGenerationTasks);
export const ttsTasks = readonly(StoreState.ttsTasks);
export const inputTranslationTasks = readonly(StoreState.inputTranslationTasks);
export const suggestionTasks = readonly(StoreState.suggestionTasks);
export const titleTasks = readonly(StoreState.titleTasks);
export const dictationTasks = readonly(StoreState.dictationTasks);
export const recordAudioTasks = readonly(StoreState.recordAudioTasks);
export const chatDrafts = readonly(StoreState.chatDrafts);
export const collectedTasks = readonly(StoreState.collectedTasks);
export const chatAssetsMap = readonly(StoreState.chatAssetsMap);
// ─── Re-export derived stores directly (already read-only) ──────────
export {
    activePreset,
    hasActiveModule,
    hasActiveRoom,
    hasActiveCharacter,
    hasActivePersona,
    hasActiveChat,
    isChatRunning,
    hasActiveRecording,
    displayMessages,
    isLoggedIn,
    userEmail,
    userId,
    username,
    isCustomServer
} from './state';

export type {
    DisplayMessage,
    DisplayMessageStatus,
    CommandTask,
    InputTranslationTask,
    MediaTask,
    SuggestionTask,
    TaskStatus,
    TitleTask,
    TranslationTask
} from './types';
export type {
    ChatDraft,
    DictationPhase,
    DictationTask,
    RecordAudioPhase,
    RecordAudioTask
} from './types';
export type {
    ChatTaskIndicator,
    CollectedTask,
    CollectedTaskKind,
    CollectedTaskStatus,
    CreateTaskMetadata,
    TaskMetadata
} from './types';

export * from './content/settings';
export * from './content/room';
export * from './content/multi';
export * from './content/character';
export * from './content/persona';
export * from './content/preset';
export * from './content/chat';
export * from './content/draft';
export * from './content/module';
export * from './content/plugin';
export * from './content/message';
export * from './content/merged';
export * from './tasks/chat';
export * from './tasks/command';
export * from './tasks/translation';
export * from './tasks/image';
export * from './tasks/tts';
export * from './tasks/input_translation';
export * from './tasks/suggestion';
export * from './tasks/title';
export * from './tasks/dictation';
export * from './tasks/record_audio';
export * from './tasks/activity';
export * from './auth';
export * from './connection';
export * from './user';
export * from './sync';
export * from './init';
export * from './theme';
