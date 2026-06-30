/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    rooms, characters, personas, presets, modules, plugins, appSettings
 * Level 2 (Room):      activeRoom (detail), roomCharacters, roomChats — loaded on select
 * Level 3 (Chat):      activeChat (detail), messages, chatLorebooks, chatPersonas — loaded on enter
 *
 * Relationship patterns:
 *   1:N (parent→child): Parent's blob holds OrderedRef[] → fetch children by ID batch
 *   N:M (consumer→resource): Consumer's blob holds ResourceRef[] → load with enabled state
 *   Owned (ownerId FK): Lorebooks, scripts owned by character/chat/module → listByOwner()
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
export const activeUser = readonly(StoreState.activeUser);
export const localUsers = readonly(StoreState.localUsers);
export const pbConnected = readonly(StoreState.pbConnected);
export const dataSyncStatus = readonly(StoreState.dataSyncStatus);
export const userSyncStatus = readonly(StoreState.userSyncStatus);
export const assetSyncStatus = readonly(StoreState.assetSyncStatus);
export const migrationLocked = readonly(StoreState.migrationLocked);
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
export const moduleLorebooks = readonly(StoreState.moduleLorebooks);
export const moduleScripts = readonly(StoreState.moduleScripts);
export const moduleCharJS = readonly(StoreState.moduleCharJS);
export const presetScripts = readonly(StoreState.presetScripts);
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
export const characterLorebooks = readonly(StoreState.characterLorebooks);
export const characterScripts = readonly(StoreState.characterScripts);
export const characterCharJS = readonly(StoreState.characterCharJS);
export const characterModules = readonly(StoreState.characterModules);
export const roomChats = readonly(StoreState.roomChats);
export const activeChat = readonly(StoreState.activeChat);
export const activeChatId = readonly(StoreState.activeChatId);
export const chatSelections = readonly(StoreState.chatSelections);
export const chatLorebooks = readonly(StoreState.chatLorebooks);
export const chatPersonas = readonly(StoreState.chatPersonas);
export const messages = readonly(StoreState.messages);
export const translations = readonly(StoreState.translations);
export const translationsByMessage = readonly(StoreState.translationsByMessage);
export const chatTasks = readonly(StoreState.chatTasks);
export const translationTasks = readonly(StoreState.translationTasks);
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
    displayMessages,
    isLoggedIn,
    userEmail,
    userId,
    username,
    isSyncServerConfigured,
    isLocalOnly,
    isSyncLinked
} from './state';

export type { DisplayMessage, DisplayMessageStatus, TaskStatus, TranslationTask } from './types';

export * from './content/settings';
export * from './content/room';
export * from './content/multi';
export * from './content/character';
export * from './content/persona';
export * from './content/preset';
export * from './content/chat';
export * from './content/module';
export * from './content/plugin';
export * from './content/message';
export * from './content/translation';
export * from './content/merged';
export * from './tasks/chat';
export * from './tasks/translation';
export * from './auth';
export * from './user';
export * from './sync';
export * from './init';
