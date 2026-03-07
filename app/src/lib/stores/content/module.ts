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
import type { OrderedRef, FolderDef } from '$lib/shared/types';
import { generateSortOrder, sortByRefs } from '$lib/shared/ordering';
import { modules, appSettings, moduleResources } from '../state';
import { AppError } from '$lib/shared/errors';
import { generateId } from '$lib/shared/id';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadModules(): Promise<void> {
	const settings = get(appSettings);
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

export async function createModule(fields: ModuleFields): Promise<Module> {
	const settings = get(appSettings) || (await SettingsService.get());

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

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

export async function updateModule(id: string, changes: Partial<ModuleContent>): Promise<void> {
	const updated = await ModuleService.updateContent(id, changes);
	modules.update((list) => list.map((m) => (m.id === id ? updated : m)));
}

export async function deleteModule(id: string): Promise<void> {
	const settings = get(appSettings) || (await SettingsService.get());

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Remove from parent's refs
	const existingRefs = settings.moduleRefs || [];
	const moduleRefs = existingRefs.filter((r) => r.id !== id);
	await SettingsService.update({ moduleRefs });

	// Remove record from DB
	try {
		await ModuleService.delete(id);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ moduleRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, moduleRefs } : s));
	modules.update((list) => list.filter((m) => m.id !== id));
	moduleResources.update((map) => {
		const m = new Map(map);
		m.delete(id);
		return m;
	});
}

// ─── Module-owned Lorebook CRUD ─────────────────────────────────────

export async function createModuleLorebook(
	moduleId: string,
	fields: Partial<LorebookFields>
): Promise<Lorebook> {
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));
	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

	// Remove from parent's refs
	const existingRefs = mod.lorebookRefs || [];
	const lorebookRefs = existingRefs.filter((r) => r.id !== lorebookId);
	await ModuleService.update(moduleId, { lorebookRefs });

	try {
		await LorebookService.delete(lorebookId, moduleId);
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
	fields: Partial<ScriptFields>
): Promise<Script> {
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

	// Remove from parent's refs
	const existingRefs = mod.scriptRefs || [];
	const scriptRefs = existingRefs.filter((r) => r.id !== scriptId);
	await ModuleService.update(moduleId, { scriptRefs });

	try {
		await ScriptService.delete(scriptId, moduleId);
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
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
	changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
	const mod = get(modules).find((m) => m.id === moduleId) || (await ModuleService.get(moduleId));

	if (!mod) {
		throw new AppError(`NOT_FOUND`, `Module not found`);
	}

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
