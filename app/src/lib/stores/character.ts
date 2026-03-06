import { get } from 'svelte/store';
import {
	CharacterService,
	type CharacterSummaryFields,
	type CharacterDataFields,
	type CharacterDataContent,
	type CharacterDetail
} from '../services/character.js';
import { ChatService } from '../services/chat.js';
import {
	LorebookService,
	ScriptService,
	type LorebookFields,
	type ScriptFields
} from '../services/index.js';
import type { Lorebook, Script } from '../services/index.js';
import type { OrderedRef, FolderDef } from '../shared/types.js';
import { clearActiveChat, sortChatsByRefs, selectChat } from './chat.js';
import { SettingsService } from '../services/index.js';
import { generateSortOrder, sortByRefs } from '../shared/ordering.js';
import {
	characters,
	activeCharacter,
	characterLorebooks,
	characterScripts,
	characterModules,
	chats,
	modules,
	appSettings,
	activeCharacterId
} from './state.js';
import { AppError } from '$lib/shared/errors.js';
import { generateId } from '../shared/id.js';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadCharacters(): Promise<void> {
	const settings = get(appSettings);
	const list = await CharacterService.list();
	if (settings?.characterRefs) {
		characters.set(sortByRefs(list, settings.characterRefs));
	} else {
		characters.set(list);
	}
}

export async function selectCharacter(characterId: string): Promise<void> {
	const detail = await CharacterService.getDetail(characterId);
	
	if (!detail) {
		throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
	}

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
}

export function clearActiveCharacter(): void {
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
): Promise<void> {
	const updated = await CharacterService.updateSummary(characterId, changes);
	characters.update((list) => list.map((c) => (c.id === characterId ? updated : c)));
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, ...updated } : c));
	}
}

export async function updateCharacterData(
	characterId: string,
	changes: Partial<CharacterDataContent>
): Promise<void> {
	const data = await CharacterService.updateData(characterId, changes);
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data } : c));
	}
}

export async function updateCharacterFull(
	characterId: string,
	summaryChanges: Partial<CharacterSummaryFields>,
	dataChanges: Partial<CharacterDataContent>
): Promise<void> {
	const result = await CharacterService.update(characterId, summaryChanges, dataChanges);
	characters.update((list) => list.map((c) => (c.id === characterId ? result : c)));
	if (characterId === get(activeCharacterId)) {
		activeCharacter.set(result);
	}
}

export async function createCharacter(
	summary: Partial<CharacterSummaryFields> = {},
	data: Partial<CharacterDataFields> = {}
): Promise<CharacterDetail> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Create record in DB
	const detail = await CharacterService.create(summary, data);

	// Add to parent's refs
	const existingRefs = settings.characterRefs || [];
	const characterRefs = [
		...existingRefs,
		{ id: detail.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await SettingsService.update({ characterRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await CharacterService.delete(detail.id);
		throw error;
	}
	
	// Update store
	appSettings.update((s) => (s ? { ...s, characterRefs } : s));
	characters.update((list) => [...list, detail]);
	return detail;
}

export async function deleteCharacter(characterId: string): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Remove from parent's refs
	const existingRefs = settings.characterRefs || [];
	const characterRefs = existingRefs.filter((r) => r.id !== characterId);
	await SettingsService.update({ characterRefs });

	// Remove record from DB
	try {
		await CharacterService.delete(characterId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ characterRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, characterRefs } : s));
	characters.update((list) => list.filter((c) => c.id !== characterId));
	if (get(activeCharacter)?.id === characterId) {
		clearActiveCharacter();
	}
}

// ─── Character-owned Lorebook CRUD ─────────────────────────────────

export async function createCharacterLorebook(characterId: string, fields: Partial<LorebookFields>): Promise<Lorebook> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}
	
	// Create Record in DB
	const lb = await LorebookService.create(characterId, fields);

	// Update parent's refs
	const existingRefs = char.data.lorebookRefs || [];
	const lorebookRefs: OrderedRef[] = [
		...existingRefs,
		{ id: lb.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await CharacterService.updateData(characterId, { lorebookRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await LorebookService.delete(lb.id);
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		characterLorebooks.update((list) => [...list, lb]);
	}
	
	return lb;
}

export async function deleteCharacterLorebook(characterId: string, lorebookId: string): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}
	
	// Remove from parent's refs
	const existingRefs = char.data.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await CharacterService.updateData(characterId, { lorebookRefs });
	
	try {
		await LorebookService.delete(lorebookId, characterId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await CharacterService.updateData(characterId, { lorebookRefs: existingRefs });
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, lorebookRefs } } : c));
		characterLorebooks.update((list) => list.filter((lb) => lb.id !== lorebookId));
	}
}

// ─── Character-owned Script CRUD ───────────────────────────────────

export async function createCharacterScript(characterId: string, fields: Partial<ScriptFields>): Promise<Script> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}
	
	// Create Record in DB
	const sc = await ScriptService.create(characterId, fields);

	// Update parent's refs
	const existingRefs = char.data.scriptRefs || [];
	const scriptRefs: OrderedRef[] = [
		...existingRefs,
		{ id: sc.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await CharacterService.updateData(characterId, { scriptRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await ScriptService.delete(sc.id);
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
		characterScripts.update((list) => [...list, sc]);
	}
	
	return sc;
}

export async function deleteCharacterScript(characterId: string, scriptId: string): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}
	
	// Remove from parent's refs
	const existingRefs = char.data.scriptRefs || [];
	const scriptRefs = existingRefs.filter((r) => r.id !== scriptId);
	await CharacterService.updateData(characterId, { scriptRefs });
	
	try {
		await ScriptService.delete(scriptId, characterId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await CharacterService.updateData(characterId, { scriptRefs: existingRefs });
		throw error;
	}

	// Update Store
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, scriptRefs } } : c));
		characterScripts.update((list) => list.filter((sc) => sc.id !== scriptId));
	}
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'chats' | 'lorebooks' | 'scripts' | 'modules';

export async function createCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = {
		...folders,
		[folderType]: [...typeFolders, newFolder]
	};

	await CharacterService.updateData(characterId, { folders: updatedFolders });

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
	
	return newFolder;
}

export async function updateCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string,
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) =>
		f.id === folderId ? { ...f, ...changes } : f
	);

	const updatedFolders = { ...folders, [folderType]: updatedTypeFolders };

	await CharacterService.updateData(characterId, { folders: updatedFolders });
	
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
}

export async function deleteCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string
): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedFolders = { ...folders, [folderType]: typeFolders.filter((f) => f.id !== folderId) };

	await CharacterService.updateData(characterId, { folders: updatedFolders });
	
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) =>
			c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c
		);
	}
}

export async function moveCharacterItem(
	characterId: string,
	folderType: CharacterFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	// Use cached active character if possible
	const char = characterId === get(activeCharacterId)
		? get(activeCharacter)
		: await CharacterService.getDetail(characterId);

	if (!char) {
		throw new AppError(`NOT_FOUND`, `Character not found`);
	}

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

	await CharacterService.updateData(characterId, { [refKey]: updatedRefs });
	
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) =>
			c ? { ...c, data: { ...c.data, [refKey]: updatedRefs } } : c
		);
	}
}
