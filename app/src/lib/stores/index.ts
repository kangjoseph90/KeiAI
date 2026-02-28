/**
 * Svelte Store — 3-Layer In-Memory State
 *
 * Level 1 (Global):    characters, personas, promptPresets, modules, plugins, appSettings
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
 */
import { loadSettings } from './settings.js';
import { loadModules } from './module.js';
import { loadPlugins } from './plugin.js';
import { loadPersonas } from './persona.js';
import { loadPresets } from './promptPreset.js';
import { loadCharacters } from './character.js';

export * from './state.js';
export * from './settings.js';
export * from './character.js';
export * from './persona.js';
export * from './promptPreset.js';
export * from './chat.js';
export * from './module.js';
export * from './plugin.js';
export * from './lorebook.js';
export * from './script.js';
export * from './message.js';
export * from './ordering.js';

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
