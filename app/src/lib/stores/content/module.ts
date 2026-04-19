import {
	ModuleService,
	LorebookService,
	ScriptService,
	CharJSService,
	SettingsService,
	type ModuleFields,
	type ModuleContent,
	type Module,
	type LorebookFields,
	type Lorebook,
	type ScriptFields,
	type Script,
	type CharJSFields,
	type CharJS
} from '$lib/services';
import type { OrderedRef, FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { modules, appSettings, moduleResources } from '../state';
import { EntityStore } from '../entity_store';
import { getAppSettings } from './settings';
import { get } from 'svelte/store';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns module from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getModule(moduleId: string): Promise<Module> {
	const cached = modules.get(moduleId);
	if (cached) return cached;
	const db = await ModuleService.get(moduleId);
	if (!db) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
	return db;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadModules(): Promise<void> {
	const settings = await getAppSettings();
	const mods = await ModuleService.list();

	if (settings?.moduleRefs) {
		modules.setAll(sortByRefs(mods, settings.moduleRefs));
	} else {
		modules.setAll(mods);
	}

	const entries = await Promise.all(
		mods.map(async (mod) => {
			const [lorebooks, scripts, charjs] = await Promise.all([
				LorebookService.listByOwner(mod.id),
				ScriptService.listByOwner(mod.id),
				CharJSService.listByOwner(mod.id)
			]);
			const lorebooksStore = new EntityStore<Lorebook>();
			lorebooksStore.setAll(sortByRefs(lorebooks, mod.lorebookRefs ?? []));
			const scriptsStore = new EntityStore<Script>();
			scriptsStore.setAll(sortByRefs(scripts, mod.scriptRefs ?? []));
			const charjsStore = new EntityStore<CharJS>();
			charjsStore.setAll(sortByRefs(charjs, mod.charjsRefs ?? []));
			return [
				mod.id,
				{ lorebooks: lorebooksStore, scripts: scriptsStore, charjs: charjsStore }
			] as const;
		})
	);

	moduleResources.set(new Map(entries));
}

export async function createModule(fields: DeepPartial<ModuleFields> = {}): Promise<Module> {
	const settings = await getAppSettings();

	// Create Record in DB
	const mod = await ModuleService.create(fields);

	// Add to parent's refs
	const existingRefs = settings.moduleRefs || [];
	const moduleRefs = [
		...existingRefs,
		{ id: mod.id, sortOrder: generateSortOrder(existingRefs), enabled: true }
	];
	try {
		await SettingsService.update({ moduleRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await ModuleService.delete(mod.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, moduleRefs } : s));
	modules.set(mod.id, mod);
	moduleResources.update((map) => {
		const m = new Map(map);
		m.set(mod.id, {
			lorebooks: new EntityStore<Lorebook>(),
			scripts: new EntityStore<Script>(),
			charjs: new EntityStore<CharJS>()
		});
		return m;
	});

	return mod;
}

export async function updateModule(
	moduleId: string,
	changes: DeepPartial<ModuleContent>
): Promise<void> {
	const updated = await ModuleService.updateContent(moduleId, changes);
	modules.set(moduleId, updated);
}

export async function deleteModule(moduleId: string): Promise<void> {
	const settings = await getAppSettings();

	// Remove from parent's refs
	const existingRefs = settings.moduleRefs || [];
	const moduleRefs = existingRefs.filter((r) => r.id !== moduleId);
	await SettingsService.update({ moduleRefs });

	// Remove record from DB
	try {
		await ModuleService.delete(moduleId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ moduleRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, moduleRefs } : s));
	modules.delete(moduleId);
	moduleResources.update((map) => {
		const m = new Map(map);
		m.delete(moduleId);
		return m;
	});
}

// ─── Module-owned Lorebook CRUD ─────────────────────────────────────

export async function createModuleLorebook(
	moduleId: string,
	fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
	const mod = await getModule(moduleId);

	// Create Record in DB
	const lb = await LorebookService.create(moduleId, fields);

	// Update parent's refs
	const existingRefs = mod.lorebookRefs || [];
	const lorebookRefs: OrderedRef[] = [
		...existingRefs,
		{ id: lb.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await ModuleService.update(moduleId, { lorebookRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await LorebookService.delete(lb.id);
		throw error;
	}

	// Update Store
	modules.set(moduleId, { ...modules.get(moduleId)!, lorebookRefs });
	get(moduleResources).get(moduleId)?.lorebooks.set(lb.id, lb);

	return lb;
}

export async function deleteModuleLorebook(moduleId: string, lorebookId: string): Promise<void> {
	const mod = await getModule(moduleId);

	// Remove from parent's refs
	const existingRefs = mod.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await ModuleService.update(moduleId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await ModuleService.update(moduleId, { lorebookRefs: existingRefs });
		throw error;
	}

	// Update Store
	modules.set(moduleId, { ...modules.get(moduleId)!, lorebookRefs });
	get(moduleResources).get(moduleId)?.lorebooks.delete(lorebookId);
}

// ─── Module-owned Script CRUD ───────────────────────────────────────

export async function createModuleScript(
	moduleId: string,
	fields: DeepPartial<ScriptFields>
): Promise<Script> {
	const mod = await getModule(moduleId);

	// Create Record in DB
	const sc = await ScriptService.create(moduleId, fields);

	// Update parent's refs
	const existingRefs = mod.scriptRefs || [];
	const scriptRefs: OrderedRef[] = [
		...existingRefs,
		{ id: sc.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await ModuleService.update(moduleId, { scriptRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await ScriptService.delete(sc.id);
		throw error;
	}

	// Update Store
	modules.set(moduleId, { ...modules.get(moduleId)!, scriptRefs });
	get(moduleResources).get(moduleId)?.scripts.set(sc.id, sc);

	return sc;
}

export async function deleteModuleScript(moduleId: string, scriptId: string): Promise<void> {
	const mod = await getModule(moduleId);

	// Remove from parent's refs
	const existingRefs = mod.scriptRefs || [];
	const scriptRefs = existingRefs.filter((r) => r.id !== scriptId);
	await ModuleService.update(moduleId, { scriptRefs });

	try {
		await ScriptService.delete(scriptId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await ModuleService.update(moduleId, { scriptRefs: existingRefs });
		throw error;
	}

	// Update Store
	modules.set(moduleId, { ...modules.get(moduleId)!, scriptRefs });
	get(moduleResources).get(moduleId)?.scripts.delete(scriptId);
}

// ─── Module-owned CharJS CRUD ───────────────────────────────────────

export async function createModuleCharJS(
	moduleId: string,
	fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
	const mod = await getModule(moduleId);

	const cjs = await CharJSService.create(moduleId, fields);

	const existingRefs = mod.charjsRefs || [];
	const charjsRefs: OrderedRef[] = [
		...existingRefs,
		{ id: cjs.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await ModuleService.update(moduleId, { charjsRefs });
	} catch (error) {
		await CharJSService.delete(cjs.id);
		throw error;
	}

	modules.set(moduleId, { ...modules.get(moduleId)!, charjsRefs });
	get(moduleResources).get(moduleId)?.charjs.set(cjs.id, cjs);

	return cjs;
}

export async function deleteModuleCharJS(moduleId: string, charjsId: string): Promise<void> {
	const mod = await getModule(moduleId);

	const existingRefs = mod.charjsRefs || [];
	const charjsRefs = existingRefs.filter((r) => r.id !== charjsId);
	await ModuleService.update(moduleId, { charjsRefs });

	try {
		await CharJSService.delete(charjsId);
	} catch (error) {
		await ModuleService.update(moduleId, { charjsRefs: existingRefs });
		throw error;
	}

	modules.set(moduleId, { ...modules.get(moduleId)!, charjsRefs });
	get(moduleResources).get(moduleId)?.charjs.delete(charjsId);
}

// ─── Module-owned Folder & Item Management ──────────────────────

export type ModuleFolderType = 'lorebooks' | 'scripts' | 'charjs';

export async function createModuleFolder(
	moduleId: string,
	folderType: ModuleFolderType,
	name: string,
	parentId?: string
): Promise<FolderDef> {
	const mod = await getModule(moduleId);

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const newFolder = {
		id: generateId(),
		name,
		sortOrder: generateSortOrder(typeFolders as OrderedRef[]),
		parentId
	};

	const updatedFolders = { ...folders, [folderType]: [...typeFolders, newFolder] };

	await ModuleService.update(moduleId, { folders: updatedFolders });

	modules.set(moduleId, { ...modules.get(moduleId)!, folders: updatedFolders });

	return newFolder;
}

export async function updateModuleFolder(
	moduleId: string,
	folderType: ModuleFolderType,
	folderId: string,
	changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	const mod = await getModule(moduleId);

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.map((f: FolderDef) =>
		f.id === folderId ? { ...f, ...changes } : f
	);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ModuleService.update(moduleId, { folders: updatedFolders });

	modules.set(moduleId, { ...modules.get(moduleId)!, folders: updatedFolders });
}

export async function deleteModuleFolder(
	moduleId: string,
	folderType: ModuleFolderType,
	folderId: string
): Promise<void> {
	const mod = await getModule(moduleId);

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];

	const updatedTypeFolders = typeFolders.filter((f: FolderDef) => f.id !== folderId);

	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	await ModuleService.update(moduleId, { folders: updatedFolders });

	modules.set(moduleId, { ...modules.get(moduleId)!, folders: updatedFolders });
}

export async function moveModuleItem(
	moduleId: string,
	folderType: ModuleFolderType,
	itemId: string,
	newFolderId?: string,
	newSortOrder?: string
): Promise<void> {
	const mod = await getModule(moduleId);

	let refKey: keyof typeof mod;
	switch (folderType) {
		case 'lorebooks':
			refKey = 'lorebookRefs';
			break;
		case 'scripts':
			refKey = 'scriptRefs';
			break;
		case 'charjs':
			refKey = 'charjsRefs';
			break;
		default:
			return;
	}

	const refs = (mod[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map((ref) => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	await ModuleService.update(moduleId, { [refKey]: updatedRefs });

	modules.set(moduleId, { ...modules.get(moduleId)!, [refKey]: updatedRefs });
}
