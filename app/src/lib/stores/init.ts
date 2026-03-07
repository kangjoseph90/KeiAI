import { loadSettings } from './content/settings';
import { loadModules } from './content/module';
import { loadPlugins } from './content/plugin';
import { loadPersonas } from './content/persona';
import { loadPresets } from './content/preset';
import { loadCharacters } from './content/character';

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
