import { loadSettings } from './content/settings';
import { loadModules } from './content/module';
import { loadPlugins } from './content/plugin';
import { loadPersonas } from './content/persona';
import { loadPresets } from './content/preset';
import { createCharacter, loadCharacters } from './content/character';
import { createPersona } from './content/persona';
import { createPreset } from './content/preset';

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

/**
 * Initialize default content for a new guest user.
 * Ensures at least one persona and preset exist (delete guard requires min 1).
 */
export async function initDefaultContents(): Promise<void> {
	await Promise.all([createPersona(), createPreset(), createCharacter()]);
}
