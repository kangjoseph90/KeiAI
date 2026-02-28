import { get } from 'svelte/store';
import { CharacterService, type Character, type CharacterDetail, type CharacterSummaryFields, type CharacterDataFields, type CharacterDataContent } from '../services/character.js';
import { ChatService } from '../services/chat.js';
import { LorebookService, ScriptService, type LorebookFields, type ScriptFields } from '../services';
import type { OrderedRef } from '../db/index.js';
import { clearActiveChat, sortChatsByRefs } from './chat.js';
import { updateSettings } from './settings.js';
import { generateSortOrder } from './ordering.js';
import {
	characters, activeCharacter, characterLorebooks, characterScripts, characterModules,
	chats, modules, appSettings
} from './state.js';

export const DEFAULT_CHARACTER_SUMMARY: CharacterSummaryFields = {
	name: 'New Character',
	shortDescription: 'New character description',
	avatarAssetId: undefined,
}

export const DEFAULT_CHARACTER_DATA: CharacterDataFields = {
	systemPrompt: '',
	greetingMessage: undefined,
	chatRefs: [],
	moduleRefs: [],
	lorebookRefs: [],
	scriptRefs: [],
	personaId: undefined,
	folders: {
		chats: [],
		lorebooks: [],
		scripts: [],
		modules: []
	},
	assets: []
}

export async function loadCharacters() {
	characters.set(await CharacterService.list());
}

export async function selectCharacter(characterId: string) {
	clearActiveChat();

	const detail = await CharacterService.getDetail(characterId);
	activeCharacter.set(detail);

	if (!detail) return; // TODO: Error handling

	const chatList = await ChatService.listByCharacter(characterId);
	chats.set(sortChatsByRefs(chatList, detail.data.chatRefs ?? []));

	const moduleIds = detail.data.moduleRefs?.map((r) => r.id) ?? [];
	characterModules.set(get(modules).filter((m) => moduleIds.includes(m.id)))
	
	const [lorebooks, scripts] = await Promise.all([
		LorebookService.listByOwner(characterId),
		ScriptService.listByOwner(characterId)
	]);
	characterLorebooks.set(lorebooks)
	characterScripts.set(scripts)
}

export function clearActiveCharacter() {
	activeCharacter.set(null);
	chats.set([]);
	characterLorebooks.set([]);
	characterScripts.set([]);
	characterModules.set([]);
	clearActiveChat();
}

export async function updateCharacterSummary(characterId: string, changes: Partial<CharacterSummaryFields>) {
	const updated = await CharacterService.updateSummary(characterId, changes);
	if (!updated) return; // TODO: Error handling
	
	characters.update((list) => list.map((c) => (c.id === characterId ? updated : c)));
	activeCharacter.update((c) => (
		c && c.id === characterId 
		? { 
			...c, 
			...updated,
			updatedAt: updated.updatedAt 
		} 
		: c
	));
}

export async function updateCharacterData(characterId: string, changes: Partial<CharacterDataContent>) {
	const result = await CharacterService.updateData(characterId, changes);
	if (!result) return; // TODO: Error handling
	
	activeCharacter.update((c) => (
		c && c.id === characterId 
		? { 
			...c,
			data: { ...c.data, ...changes },
			updatedAt: result.updatedAt 
		} 
		: c
	));
}

export async function createCharacter(
    summary: CharacterSummaryFields = DEFAULT_CHARACTER_SUMMARY,
    data: CharacterDataFields = DEFAULT_CHARACTER_DATA
) {
    const detail = await CharacterService.create(summary, data);
    if (!detail) return; // TODO: Error handling

    characters.update((list) => [...list, detail]);

    // Add to settings' characterRefs
    const settings = get(appSettings);
	if (!settings) return;

    const existingRefs = settings.characterRefs || [];
    await updateSettings({
        characterRefs: [
			...existingRefs,
			{ 
				id: detail.id,
				sortOrder: generateSortOrder(existingRefs) 
			}
		]
    });

    return detail;
}

export async function deleteCharacter(characterId: string) {
    await CharacterService.delete(characterId);

    const settings = get(appSettings);
    if (!settings) return;

    await updateSettings({
        characterRefs: (settings.characterRefs || []).filter((r) => r.id !== characterId)
    });

    characters.update((list) => list.filter((c) => c.id !== characterId));
    if (get(activeCharacter)?.id === characterId) {
        clearActiveCharacter();
    }
}

// ─── Character-owned Lorebook CRUD ─────────────────────────────────

export async function createCharacterLorebook(characterId: string, fields: LorebookFields) {
	const lb = await LorebookService.create(characterId, fields);

	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const existing = char.data.lorebookRefs ?? [];
		const lorebookRefs: OrderedRef[] = [...existing, { id: lb.id, sortOrder: generateSortOrder(existing) }];
		await CharacterService.updateData(characterId, { lorebookRefs });
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		characterLorebooks.update((list) => [...list, lb]);
	}

	return lb;
}

export async function deleteCharacterLorebook(characterId: string, lorebookId: string) {
	await LorebookService.delete(lorebookId);

	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const lorebookRefs = (char.data.lorebookRefs ?? []).filter((r) => r.id !== lorebookId);
		await CharacterService.updateData(characterId, { lorebookRefs });
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		characterLorebooks.update((list) => list.filter((lb) => lb.id !== lorebookId));
	}
}

// ─── Character-owned Script CRUD ───────────────────────────────────

export async function createCharacterScript(characterId: string, fields: ScriptFields) {
	const sc = await ScriptService.create(characterId, fields);

	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const existing = char.data.scriptRefs ?? [];
		const scriptRefs: OrderedRef[] = [...existing, { id: sc.id, sortOrder: generateSortOrder(existing) }];
		await CharacterService.updateData(characterId, { scriptRefs });
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
		characterScripts.update((list) => [...list, sc]);
	}

	return sc;
}

export async function deleteCharacterScript(characterId: string, scriptId: string) {
	await ScriptService.delete(scriptId);

	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const scriptRefs = (char.data.scriptRefs ?? []).filter((r) => r.id !== scriptId);
		await CharacterService.updateData(characterId, { scriptRefs });
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
		characterScripts.update((list) => list.filter((s) => s.id !== scriptId));
	}
}
