import { getOrCreateInstance } from './engine';
import type { CharJSInstance, ModeKind } from './types';
import { getChat } from '$lib/stores/content/chat';
import { getCharacter } from '$lib/stores/content/character';
import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule } from '$lib/stores/content/module';

/**
 * Collect all active CharJS instances for a chat + specific mode.
 * Resolves character + module charjsRefs → creates/reuses per-mode instances.
 *
 * @param kind - 'pipe' for pipeline phases, 'event' for event listeners
 * @param mode - the specific phase or event name (e.g. 'output', 'message:sent')
 */
export async function collectCharJSInstances(
	chatId: string,
	kind: ModeKind,
	mode: string
): Promise<CharJSInstance[]> {
	const chat = await getChat(chatId);
	const character = await getCharacter(chat.characterId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const charjsRequests: Array<{ id: string; allowLowLevel: boolean }> = [];

	if (character.charjsRefs) {
		const allow = character.allowLowLevel;
		charjsRequests.push(...character.charjsRefs.map((r) => ({ id: r.id, allowLowLevel: allow })));
	}

	const modules = await Promise.all([...activeModuleIds].map((id) => getModule(id)));
	for (const mod of modules) {
		if (mod.charjsRefs) {
			const allow = mod.allowLowLevel;
			charjsRequests.push(...mod.charjsRefs.map((r) => ({ id: r.id, allowLowLevel: allow })));
		}
	}

	const instances = await Promise.all(
		charjsRequests.map((req) => getOrCreateInstance(chatId, req.id, kind, mode, req.allowLowLevel))
	);

	return instances.filter((i): i is CharJSInstance => i !== null);
}
