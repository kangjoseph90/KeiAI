import { get } from 'svelte/store';
import {
	ModuleService,
	LorebookService,
	ScriptService,
	SettingsService,
	type ModuleFields,
	type ModuleContent,
	type Module,
	type LorebookFields,
	type Lorebook,
	type ScriptFields,
	type Script
} from '$lib/services';
import type { OrderedRef, FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { modules, appSettings, moduleResources } from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns module from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getModule(moduleId: string): Promise<Module> {
	const active = get(modules).find((m) => m.id === moduleId);
	if (active) return active;
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
		modules.set(sortByRefs(mods, settings.moduleRefs));
	} else {
		modules.set(mods);
	}

	const entries = await Promise.all(
		mods.map(async (mod) => {
			const [lorebooks, scripts] = await Promise.all([
				LorebookService.listByOwner(mod.id),
				ScriptService.listByOwner(mod.id)
			]);
			return [
				mod.id,
				{
					lorebooks: sortByRefs(lorebooks, mod.lorebookRefs ?? []),
					scripts: sortByRefs(scripts, mod.scriptRefs ?? [])
				}
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
	modules.update((list) => [...list, mod]);
	moduleResources.update((map) => {
		const m = new Map(map);
		m.set(mod.id, { lorebooks: [], scripts: [] });
		return m;
	});

	return mod;
}

export async function updateModule(
	moduleId: string,
	changes: DeepPartial<ModuleContent>
): Promise<void> {
	const updated = await ModuleService.updateContent(moduleId, changes);
	modules.update((list) => list.map((m) => (m.id === moduleId ? updated : m)));
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
	modules.update((list) => list.filter((m) => m.id !== moduleId));
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
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, lorebookRefs } : m)));
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId) ?? { lorebooks: [], scripts: [] };
		m.set(moduleId, { ...entry, lorebooks: [...entry.lorebooks, lb] });
		return m;
	});

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
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, lorebookRefs } : m)));
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId);
		if (entry)
			m.set(moduleId, {
				...entry,
				lorebooks: entry.lorebooks.filter((lb) => lb.id !== lorebookId)
			});
		return m;
	});
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
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, scriptRefs } : m)));
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId) ?? { lorebooks: [], scripts: [] };
		m.set(moduleId, { ...entry, scripts: [...entry.scripts, sc] });
		return m;
	});

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
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, scriptRefs } : m)));
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId);
		if (entry)
			m.set(moduleId, { ...entry, scripts: entry.scripts.filter((s) => s.id !== scriptId) });
		return m;
	});
}

// ─── Module-owned Folder & Item Management ──────────────────────

export type ModuleFolderType = 'lorebooks' | 'scripts';

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

	modules.update((list) =>
		list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders } : m))
	);

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

	modules.update((list) =>
		list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders } : m))
	);
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

	modules.update((list) =>
		list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders } : m))
	);
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

	modules.update((list) =>
		list.map((m) => (m.id === moduleId ? { ...m, [refKey]: updatedRefs } : m))
	);
}
