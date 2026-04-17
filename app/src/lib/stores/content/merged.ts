import {
	LorebookService,
	ScriptService,
	type Lorebook,
	type Script,
	type Module
} from '$lib/services';
import { sortByRefs } from '$lib/utils/ordering';
import { getChatDetail } from './chat';
import { getCharacterDetail } from './character';
import { getAppSettings } from './settings';
import { getModule } from './module';

/**
 * Returns active module IDs for a character.
 * Combines globally enabled modules and character-specific modules.
 */
export async function getActiveModuleIds(characterId: string): Promise<Set<string>> {
	const [settings, char] = await Promise.all([getAppSettings(), getCharacterDetail(characterId)]);

	const ids = new Set<string>();
	for (const r of settings.moduleRefs ?? []) {
		if (r.enabled) ids.add(r.id);
	}
	for (const r of char.data.moduleRefs ?? []) {
		ids.add(r.id);
	}
	return ids;
}

/**
 * Returns merged lorebooks from chat, character, and active modules.
 * Fetches from DB and combines in priority order.
 */
export async function getMergedLorebooks(chatId: string): Promise<Lorebook[]> {
	const chat = await getChatDetail(chatId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const [chatLB, charLB, modules] = await Promise.all([
		LorebookService.listByOwner(chatId),
		LorebookService.listByOwner(chat.characterId),
		Promise.all([...activeModuleIds].map((id) => getModule(id)))
	]);

	const modLBResults = await Promise.all(
		modules.map(async (mod) => {
			return await LorebookService.listByOwner(mod.id);
		})
	);

	const modLB = modLBResults.flat();

	return [...modLB, ...charLB, ...chatLB];
}

/**
 * Returns merged scripts from character and active modules.
 * Fetches from DB and combines in priority order.
 */
export async function getMergedScripts(chatId: string): Promise<Script[]> {
	const chat = await getChatDetail(chatId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const [charSC, modules] = await Promise.all([
		ScriptService.listByOwner(chat.characterId),
		Promise.all([...activeModuleIds].map((id) => getModule(id)))
	]);

	const modSCResults = await Promise.all(
		modules.map(async (mod) => {
			return await ScriptService.listByOwner(mod.id);
		})
	);

	const modSC = modSCResults.flat();

	return [...modSC, ...charSC];
}
