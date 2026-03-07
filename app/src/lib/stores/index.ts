/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    characters, personas, presets, modules, plugins, appSettings
 * Level 2 (Character): activeCharacter (detail), activeChats — loaded on select
 * Level 3 (Chat):      activeChat (detail), messages, chatLorebooks, chatScripts — loaded on enter
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
import { loadSettings } from './content/settings.js';
import { loadModules } from './content/module.js';
import { loadPlugins } from './content/plugin.js';
import { loadPersonas } from './content/persona.js';
import { loadPresets } from './content/preset.js';
import { loadCharacters } from './content/character.js';
import { loadProfile } from './auth/profile.js';

// ─── Re-export writable stores as readonly ──────────────────────────
import * as StoreState from './state.js';

export const appSettings = readonly(StoreState.appSettings);
export const activeUser = readonly(StoreState.activeUser);
export const characters = readonly(StoreState.characters);
export const personas = readonly(StoreState.personas);
export const presets = readonly(StoreState.presets);
export const modules = readonly(StoreState.modules);
export const plugins = readonly(StoreState.plugins);
export const moduleResources = readonly(StoreState.moduleResources);
export const activeCharacter = readonly(StoreState.activeCharacter);
export const characterLorebooks = readonly(StoreState.characterLorebooks);
export const characterScripts = readonly(StoreState.characterScripts);
export const characterModules = readonly(StoreState.characterModules);
export const chats = readonly(StoreState.chats);
export const activeChat = readonly(StoreState.activeChat);
export const chatLorebooks = readonly(StoreState.chatLorebooks);
export const messages = readonly(StoreState.messages);
export const generationTasks = readonly(StoreState.generationTasks);
export const activePreset = readonly(StoreState.activePreset);
export const activeLorebooks = readonly(StoreState.activeLorebooks);
export const activeScripts = readonly(StoreState.activeScripts);

// ─── Re-export derived stores directly (already read-only) ──────────
export {
	activeCharacterId,
	hasActiveCharacter,
	activeChatId,
	hasActiveChat,
	activeModuleIds,
	allLorebooks,
	allScripts,
	activePersona,
	isGenerating	,
	displayMessages
} from './state.js';
export type { DisplayMessage, DisplayMessageStatus, GenerationTask, GenerationStatus } from './types.js';

export * from './content/settings.js';
export * from './content/character.js';
export * from './content/persona.js';
export * from './content/preset.js';
export * from './content/chat.js';
export * from './content/module.js';
export * from './content/plugin.js';
export * from './content/lorebook.js';
export * from './content/script.js';
export * from './content/message.js';
export * from './generation.js';
export * from './auth/profile.js';
export * from '../shared/ordering.js';

export async function loadGlobalState() {
	await loadSettings();
	await Promise.all([
		loadModules(),
		loadPlugins(),
		loadPersonas(),
		loadPresets(),
		loadCharacters()
	]);
}
