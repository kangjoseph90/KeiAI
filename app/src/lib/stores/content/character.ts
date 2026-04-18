import { get } from 'svelte/store';
import {
	CharacterService,
	ChatService,
	LorebookService,
	ScriptService,
	CharJSService,
	SettingsService,
	type CharacterSummaryFields,
	type CharacterDataFields,
	type CharacterDataContent,
	type CharacterDetail,
	type LorebookFields,
	type ScriptFields,
	type CharJSFields,
	type Lorebook,
	type Script,
	type CharJS
} from '$lib/services';
import type { OrderedRef, FolderDef } from '$lib/types/refs';
import { clearActiveChat } from './chat';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
	characters,
	activeCharacter,
	characterLorebooks,
	characterScripts,
	characterCharJS,
	characterModules,
	chats,
	modules,
	appSettings,
	activeCharacterId
} from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns character detail from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getCharacterDetail(characterId: string): Promise<CharacterDetail> {
	const active = get(activeCharacter);
	if (active?.id === characterId) return active;
	const db = await CharacterService.getDetail(characterId);
	if (!db) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
	return db;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadCharacters(): Promise<void> {
	const settings = await getAppSettings();
	const list = await CharacterService.list();
	if (settings?.characterRefs) {
		characters.set(sortByRefs(list, settings.characterRefs));
	} else {
		characters.set(list);
	}
}

export async function selectCharacter(characterId: string): Promise<void> {
	const detail = await getCharacterDetail(characterId);

	activeCharacter.set(detail);

	clearActiveChat();
	const chatList = await ChatService.listByCharacter(characterId);
	chats.set(sortByRefs(chatList, detail.data.chatRefs ?? []));

	const moduleIds = detail.data.moduleRefs?.map((r) => r.id) ?? [];
	characterModules.set(get(modules).filter((m) => moduleIds.includes(m.id)));

	const [lorebooks, scripts, charjs] = await Promise.all([
		LorebookService.listByOwner(characterId),
		ScriptService.listByOwner(characterId),
		CharJSService.listByOwner(characterId)
	]);

	characterLorebooks.set(sortByRefs(lorebooks, detail.data.lorebookRefs ?? []));
	characterScripts.set(sortByRefs(scripts, detail.data.scriptRefs ?? []));
	characterCharJS.set(sortByRefs(charjs, detail.data.charjsRefs ?? []));
}

export function clearActiveCharacter(): void {
	activeCharacter.set(null);
	chats.set([]);
	characterLorebooks.set([]);
	characterScripts.set([]);
	characterCharJS.set([]);
	characterModules.set([]);
	clearActiveChat();
}

export async function updateCharacterSummary(
	characterId: string,
	changes: DeepPartial<CharacterSummaryFields>
): Promise<void> {
	const updated = await CharacterService.updateSummary(characterId, changes);
	characters.update((list) => list.map((c) => (c.id === characterId ? updated : c)));
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, ...updated } : c));
	}
}

export async function updateCharacterData(
	characterId: string,
	changes: DeepPartial<CharacterDataContent>
): Promise<void> {
	const data = await CharacterService.updateData(characterId, changes);
	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data } : c));
	}
}

export async function updateCharacterFull(
	characterId: string,
	summaryChanges: DeepPartial<CharacterSummaryFields>,
	dataChanges: DeepPartial<CharacterDataContent>
): Promise<void> {
	const result = await CharacterService.update(characterId, summaryChanges, dataChanges);
	characters.update((list) => list.map((c) => (c.id === characterId ? result : c)));
	if (characterId === get(activeCharacterId)) {
		activeCharacter.set(result);
	}
}

export async function createCharacter(
	summary: DeepPartial<CharacterSummaryFields> = {},
	data: DeepPartial<CharacterDataFields> = {}
): Promise<CharacterDetail> {
	const settings = await getAppSettings();

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
	const settings = await getAppSettings();

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

export async function createCharacterLorebook(
	characterId: string,
	fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

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

export async function deleteCharacterLorebook(
	characterId: string,
	lorebookId: string
): Promise<void> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

	// Remove from parent's refs
	const existingRefs = char.data.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await CharacterService.updateData(characterId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId);
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

export async function createCharacterScript(
	characterId: string,
	fields: DeepPartial<ScriptFields>
): Promise<Script> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

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
	const char = await getCharacterDetail(characterId);

	// Remove from parent's refs
	const existingRefs = char.data.scriptRefs || [];
	const scriptRefs = existingRefs.filter((r) => r.id !== scriptId);
	await CharacterService.updateData(characterId, { scriptRefs });

	try {
		await ScriptService.delete(scriptId);
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

// ─── Character-owned CharJS CRUD ───────────────────────────────────

export async function createCharacterCharJS(
	characterId: string,
	fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
	const char = await getCharacterDetail(characterId);
	const cjs = await CharJSService.create(characterId, fields);

	const existingRefs = char.data.charjsRefs || [];
	const charjsRefs: OrderedRef[] = [
		...existingRefs,
		{ id: cjs.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await CharacterService.updateData(characterId, { charjsRefs });
	} catch (error) {
		await CharJSService.delete(cjs.id);
		throw error;
	}

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, charjsRefs } } : c));
		characterCharJS.update((list) => [...list, cjs]);
	}

	return cjs;
}

export async function deleteCharacterCharJS(characterId: string, charjsId: string): Promise<void> {
	const char = await getCharacterDetail(characterId);

	const existingRefs = char.data.charjsRefs || [];
	const charjsRefs = existingRefs.filter((r) => r.id !== charjsId);
	await CharacterService.updateData(characterId, { charjsRefs });

	try {
		await CharJSService.delete(charjsId);
	} catch (error) {
		await CharacterService.updateData(characterId, { charjsRefs: existingRefs });
		throw error;
	}

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, charjsRefs } } : c));
		characterCharJS.update((list) => list.filter((cjs) => cjs.id !== charjsId));
	}
}

// ─── Character-owned Folder & Item Management ──────────────────────

export type CharacterFolderType = 'chats' | 'lorebooks' | 'scripts' | 'modules' | 'charjs';

export async function createCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

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
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
	}

	return newFolder;
}

export async function updateCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string,
	changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f) => (f.id === folderId ? { ...f, ...changes } : f));

	const updatedFolders = { ...folders, [folderType]: updatedTypeFolders };

	await CharacterService.updateData(characterId, { folders: updatedFolders });

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
	}
}

export async function deleteCharacterFolder(
	characterId: string,
	folderType: CharacterFolderType,
	folderId: string
): Promise<void> {
	// Use cached active character if possible
	const char = await getCharacterDetail(characterId);

	const folders = char.data.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedFolders = { ...folders, [folderType]: typeFolders.filter((f) => f.id !== folderId) };

	await CharacterService.updateData(characterId, { folders: updatedFolders });

	if (characterId === get(activeCharacterId)) {
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, folders: updatedFolders } } : c));
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
	const char = await getCharacterDetail(characterId);

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
		case 'charjs':
			refKey = 'charjsRefs';
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
		activeCharacter.update((c) => (c ? { ...c, data: { ...c.data, [refKey]: updatedRefs } } : c));
	}
}
