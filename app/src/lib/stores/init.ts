import { loadSettings } from './content/settings';
import { loadModules } from './content/module';
import { loadPlugins } from './content/plugin';
import { loadPersonas } from './content/persona';
import { loadPresets, selectPreset } from './content/preset';
import { createCharacter, loadCharacters } from './content/character';
import { addRoomCharacter, createRoom, loadRooms } from './content/room';
import { createPersona } from './content/persona';
import { createPreset } from './content/preset';
import { loadMultiRooms } from './content/multi';

export async function loadGlobalState() {
    await loadSettings();
    await Promise.all([
        loadModules(),
        loadPlugins(),
        loadPersonas(),
        loadPresets(),
        loadCharacters(),
        loadRooms(),
        loadMultiRooms()
    ]);
}

/**
 * Initialize default content for a new local identity.
 * Ensures at least one persona and preset exist (delete guard requires min 1).
 * Also selects the newly created preset as the global default.
 */
export async function initDefaultContents(): Promise<void> {
    const [, preset, character, room] = await Promise.all([
        createPersona(),
        createPreset(),
        createCharacter(),
        createRoom()
    ]);
    await addRoomCharacter(room.id, character.id);
    await selectPreset(preset.id);
}
