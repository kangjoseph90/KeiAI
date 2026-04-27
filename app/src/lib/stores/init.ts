import { loadSettings } from './content/settings';
import { loadModules } from './content/module';
import { loadPlugins } from './content/plugin';
import { loadPersonas, selectPersona } from './content/persona';
import { loadPresets, selectPreset } from './content/preset';
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
 * Initialize default content for a new local identity.
 * Ensures at least one persona and preset exist (delete guard requires min 1).
 * Also selects the newly created persona and preset as defaults.
 */
export async function initDefaultContents(): Promise<void> {
    const [persona, preset] = await Promise.all([
        createPersona(),
        createPreset(),
        createCharacter()
    ]);
    await Promise.all([selectPersona(persona.id), selectPreset(preset.id)]);
}
