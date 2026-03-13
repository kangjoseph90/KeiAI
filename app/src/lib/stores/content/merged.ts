import {
	LorebookService,
	ScriptService,
	type Lorebook,
	type Script,
	type Module
} from '$lib/services';
import { sortByRefs } from '$lib/shared/ordering';
import { getChatDetail } from './chat';
import { getCharacterDetail } from './character';
import { getAppSettings } from './settings';
import { getModule } from './module';

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

export async function getMergedLorebooks(chatId: string): Promise<Lorebook[]> {
	const chat = await getChatDetail(chatId);
	const char = await getCharacterDetail(chat.characterId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const [chatLB, charLB, modules] = await Promise.all([
		LorebookService.listByOwner(chatId),
		LorebookService.listByOwner(chat.characterId),
		Promise.all([...activeModuleIds].map((id) => getModule(id)))
	]);

	const modLBResults = await Promise.all(
		modules.map(async (mod) => {
			const lb = await LorebookService.listByOwner(mod.id);
			return sortByRefs(lb, mod.lorebookRefs ?? []);
		})
	);

	const modLB = modLBResults.flat();
	const charSorted = sortByRefs(charLB, char.data.lorebookRefs ?? []);
	const chatSorted = sortByRefs(chatLB, chat.data.lorebookRefs ?? []);

	return [...modLB, ...charSorted, ...chatSorted];
}

export async function getMergedScripts(chatId: string): Promise<Script[]> {
	const chat = await getChatDetail(chatId);
	const char = await getCharacterDetail(chat.characterId);
	const activeModuleIds = await getActiveModuleIds(chat.characterId);

	const [charSC, modules] = await Promise.all([
		ScriptService.listByOwner(chat.characterId),
		Promise.all([...activeModuleIds].map((id) => getModule(id)))
	]);

	const modSCResults = await Promise.all(
		modules.map(async (mod) => {
			const sc = await ScriptService.listByOwner(mod.id);
			return sortByRefs(sc, mod.scriptRefs ?? []);
		})
	);

	const modSC = modSCResults.flat();
	const charSorted = sortByRefs(charSC, char.data.scriptRefs ?? []);

	return [...modSC, ...charSorted];
}
