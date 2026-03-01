import { get } from 'svelte/store';
import {
	CharacterService,
	type CharacterSummaryFields,
	type CharacterDataFields,
	type CharacterDataContent
} from '../services/character.js';
import { ChatService } from '../services/chat.js';
import {
	LorebookService,
	ScriptService,
	type LorebookFields,
	type ScriptFields
} from '../services';
import type { OrderedRef } from '../db/index.js';
import { clearActiveChat, sortChatsByRefs, selectChat } from './chat.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import {
	characters,
	activeCharacter,
	characterLorebooks,
	characterScripts,
	characterModules,
	chats,
	modules,
	appSettings
} from './state.js';

export const DEFAULT_CHARACTER_SUMMARY: CharacterSummaryFields = {
	name: 'New Character',
	shortDescription: 'New character description',
	avatarAssetId: undefined
};

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
};

export async function loadCharacters() {
	const settings = get(appSettings);
	const list = await CharacterService.list();
	if (settings?.characterRefs) {
		characters.set(sortByRefs(list, settings.characterRefs));
	} else {
		characters.set(list);
	}
}

export async function selectCharacter(characterId: string) {
	// 캐릭터 참조 검증
	const detail = await CharacterService.getDetail(characterId);
	if (!detail) return; // TODO: Error handling

	activeCharacter.set(detail);

	clearActiveChat();
	const chatList = await ChatService.listByCharacter(characterId);
	chats.set(sortChatsByRefs(chatList, detail.data.chatRefs ?? []));

	const moduleIds = detail.data.moduleRefs?.map((r) => r.id) ?? [];
	characterModules.set(get(modules).filter((m) => moduleIds.includes(m.id)));

	const [lorebooks, scripts] = await Promise.all([
		LorebookService.listByOwner(characterId),
		ScriptService.listByOwner(characterId)
	]);

	characterLorebooks.set(sortByRefs(lorebooks, detail.data.lorebookRefs ?? []));
	characterScripts.set(sortByRefs(scripts, detail.data.scriptRefs ?? []));

	if (detail.data.lastActiveChatId && chatList.some((c) => c.id === detail.data.lastActiveChatId)) {
		await selectChat(detail.data.lastActiveChatId, characterId);
	}
}

export function clearActiveCharacter() {
	activeCharacter.set(null);
	chats.set([]);
	characterLorebooks.set([]);
	characterScripts.set([]);
	characterModules.set([]);
	clearActiveChat();
}

export async function updateCharacterSummary(
	characterId: string,
	changes: Partial<CharacterSummaryFields>
) {
	const updated = await CharacterService.updateSummary(characterId, changes);
	if (!updated) return; // TODO: Error handling

	characters.update((list) => list.map((c) => (c.id === characterId ? updated : c)));
	activeCharacter.update((c) =>
		c && c.id === characterId
			? {
					...c,
					...updated
				}
			: c
	);
}

export async function updateCharacterData(
	characterId: string,
	changes: Partial<CharacterDataContent>
) {
	const updated = await CharacterService.updateData(characterId, changes);
	if (!updated) return; // TODO: Error handling

	activeCharacter.update((c) =>
		c && c.id === characterId
			? {
					...c,
					data: updated.data,
					updatedAt: updated.updatedAt
				}
			: c
	);
}

export async function updateCharacterFull(
	characterId: string,
	summaryChanges: Partial<CharacterSummaryFields>,
	dataChanges: Partial<CharacterDataContent>
) {
	const result = await CharacterService.update(characterId, summaryChanges, dataChanges);
	if (!result) return;

	characters.update((list) => list.map((c) => (c.id === characterId ? result : c)));
	activeCharacter.update((c) => {
		if (c && c.id === characterId) {
			return result;
		}
		return c;
	});
}

export async function createCharacter(
	summary: CharacterSummaryFields = DEFAULT_CHARACTER_SUMMARY,
	data: CharacterDataFields = DEFAULT_CHARACTER_DATA
) {
	const settings = get(appSettings);
	if (!settings) return;

	const detail = await CharacterService.create(summary, data);
	if (!detail) return; // TODO: Error handling

	// Add to settings' characterRefs
	const existingRefs = settings.characterRefs || [];
	const characterRefs = [
		...existingRefs,
		{ id: detail.id, sortOrder: generateSortOrder(existingRefs) }
	];
	const updatedSettings = await SettingsService.update({ characterRefs });
	if (!updatedSettings) {
		await CharacterService.delete(detail.id);
		return;
	}

	characters.update((list) => [...list, detail]);
	appSettings.set(updatedSettings);

	return detail;
}

export async function deleteCharacter(characterId: string) {
	const settings = get(appSettings);
	if (!settings) return;
	const existingRefs = settings.characterRefs || [];
	const characterRefs = existingRefs.filter((r) => r.id !== characterId);

	const updatedSettings = await SettingsService.update({ characterRefs });
	if (!updatedSettings) return;

	try {
		await CharacterService.delete(characterId);
	} catch (error) {
		const rolledBackSettings = await SettingsService.update({ characterRefs: existingRefs });
		if (rolledBackSettings) appSettings.set(rolledBackSettings);
		throw error;
	}

	appSettings.set(updatedSettings);

	characters.update((list) => list.filter((c) => c.id !== characterId));
	if (get(activeCharacter)?.id === characterId) {
		clearActiveCharacter();
	}
}

// ─── Character-owned Lorebook CRUD ─────────────────────────────────

export async function createCharacterLorebook(characterId: string, fields: LorebookFields) {
	const lb = await LorebookService.create(characterId, fields);

	const char = get(activeCharacter);
	if (!char || char.id !== characterId) {
		await LorebookService.delete(lb.id);
		return;
	}

	const existing = char.data.lorebookRefs ?? [];
	const lorebookRefs: OrderedRef[] = [
		...existing,
		{ id: lb.id, sortOrder: generateSortOrder(existing) }
	];
	const result = await CharacterService.updateData(characterId, { lorebookRefs });
	if (!result) {
		await LorebookService.delete(lb.id);
		return;
	}

	activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
	characterLorebooks.update((list) => [...list, lb]);

	return lb;
}

export async function deleteCharacterLorebook(characterId: string, lorebookId: string) {
	await LorebookService.delete(lorebookId, characterId);

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
	if (!char || char.id !== characterId) {
		await ScriptService.delete(sc.id);
		return;
	}

	const existing = char.data.scriptRefs ?? [];
	const scriptRefs: OrderedRef[] = [
		...existing,
		{ id: sc.id, sortOrder: generateSortOrder(existing) }
	];
	const result = await CharacterService.updateData(characterId, { scriptRefs });
	if (!result) {
		await ScriptService.delete(sc.id);
		return;
	}

	activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
	characterScripts.update((list) => [...list, sc]);

	return sc;
}

export async function deleteCharacterScript(characterId: string, scriptId: string) {
	await ScriptService.delete(scriptId, characterId);

	const char = get(activeCharacter);
	if (char && char.id === characterId) {
		const scriptRefs = (char.data.scriptRefs ?? []).filter((r) => r.id !== scriptId);
		await CharacterService.updateData(characterId, { scriptRefs });
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
		characterScripts.update((list) => list.filter((s) => s.id !== scriptId));
	}
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'chats' | 'lorebooks' | 'scripts' | 'modules';

export async function createCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	name: string,
	parentId?: string
) {
	const char = get(activeCharacter);
	if (!char || char.id !== characterId) return;

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: crypto.randomUUID(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = {
		...folders,
		[folderType]: [...typeFolders, newFolder]
	};

	const result = await CharacterService.updateData(characterId, { folders: updatedFolders });
	if (result) {
		activeCharacter.update((c) =>
			c
				? {
						...c,
						data: { ...c.data, folders: updatedFolders },
						updatedAt: result.updatedAt
					}
				: c
		);
	}
	return newFolder;
}

export async function updateCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
) {
	const char = get(activeCharacter);
	if (!char || char.id !== characterId) return;

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => {
		if (f.id !== folderId) return f;
		return {
			...f,
			...changes
		};
	});

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const result = await CharacterService.updateData(characterId, { folders: updatedFolders });
	if (!result) return;
	activeCharacter.update((c) =>
		c
			? {
					...c,
					data: { ...c.data, folders: updatedFolders },
					updatedAt: result.updatedAt
				}
			: c
	);
}

export async function deleteCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string
) {
	const char = get(activeCharacter);
	if (!char || char.id !== characterId) return;

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.filter((f) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const result = await CharacterService.updateData(characterId, { folders: updatedFolders });
	if (!result) return;
	activeCharacter.update((c) =>
		c
			? {
					...c,
					data: { ...c.data, folders: updatedFolders },
					updatedAt: result.updatedAt
				}
			: c
	);
}

export async function moveCharacterItem(
	characterId: string,
	folderType: CharacterFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
) {
	const char = get(activeCharacter);
	if (!char || char.id !== characterId) return;

	let refKey: keyof typeof char.data;
	switch (folderType) {
		case 'chats':
			refKey = 'chatRefs';
			break;
		case 'lorebooks':
			refKey = 'lorebookRefs';
			break;
		case 'scripts':
			refKey = 'scriptRefs';
			break;
		case 'modules':
			refKey = 'moduleRefs';
			break;
		default:
			return;
	}

	const refs = (char.data[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder // Only update sortOrder if explicitly provided
		};
	});

	const result = await CharacterService.updateData(characterId, { [refKey]: updatedRefs });
	if (!result) return;
	activeCharacter.update((c) =>
		c
			? {
					...c,
					data: { ...c.data, [refKey]: updatedRefs },
					updatedAt: result.updatedAt
				}
			: c
	);
}
