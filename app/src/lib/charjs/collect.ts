import { getOrCreateInstance } from './engine';
import type { CharJSInstance } from './types';
import { getChatDetail } from '$lib/stores/content/chat';
import { getCharacterDetail } from '$lib/stores/content/character';
import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule } from '$lib/stores/content/module';

/**
 * Collect all active CharJS instances for a chat.
 * Resolves character + module charjsRefs → creates/reuses instances.
 */
export async function collectCharJSInstances(chatId: string): Promise<CharJSInstance[]> {
	const chat = await getChatDetail(chatId);
	const character = await getCharacterDetail(chat.characterId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const charjsRequests: Array<{ id: string; allowLowLevel: boolean }> = [];

	if (character.data.charjsRefs) {
		const allow = character.data.allowLowLevel;
		charjsRequests.push(
			...character.data.charjsRefs.map((r) => ({ id: r.id, allowLowLevel: allow }))
		);
	}

	const modules = await Promise.all([...activeModuleIds].map((id) => getModule(id)));
	for (const mod of modules) {
		if (mod.charjsRefs) {
			const allow = mod.allowLowLevel;
			charjsRequests.push(...mod.charjsRefs.map((r) => ({ id: r.id, allowLowLevel: allow })));
		}
	}

	const instances = await Promise.all(
		charjsRequests.map((req) => getOrCreateInstance(chatId, req.id, req.allowLowLevel))
	);

	return instances.filter((i): i is CharJSInstance => i !== null);
}
