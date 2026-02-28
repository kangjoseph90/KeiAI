import { get } from 'svelte/store';
import { ModuleService, type Module, type ModuleFields, type ModuleContent } from '../services/module.js';
import { LorebookService, type LorebookFields } from '../services/lorebook.js';
import { ScriptService, type ScriptFields } from '../services/script.js';
import type { OrderedRef, FolderDef } from '../db/index.js';
import { updateSettings } from './settings.js';
import { generateSortOrder, sortByRefs } from './ordering.js';
import { modules, appSettings, moduleResources } from './state.js';

export async function loadModules() {
	const settings = get(appSettings);
	const mods = await ModuleService.list();

	if (settings?.moduleRefs) {
		modules.set(sortByRefs(mods, settings.moduleRefs));
	} else {
		modules.set(mods);
	}

	const entries = await Promise.all(mods.map(async (mod) => {
		const [lorebooks, scripts] = await Promise.all([
			LorebookService.listByOwner(mod.id),
			ScriptService.listByOwner(mod.id)
		]);
		return [mod.id, { 
			lorebooks: sortByRefs(lorebooks, mod.lorebookRefs ?? []), 
			scripts: sortByRefs(scripts, mod.scriptRefs ?? []) 
		}] as const;
	}));

	moduleResources.set(new Map(entries));
}

export async function createModule(fields: ModuleFields) {
	const settings = get(appSettings);
	if (!settings) return;

	const mod = await ModuleService.create(fields);
	modules.update((list) => [...list, mod]);
	moduleResources.update((map) => new Map(map).set(mod.id, { lorebooks: [], scripts: [] }));
	const existing = settings.moduleRefs || [];
	await updateSettings({
		moduleRefs: [...existing, { id: mod.id, sortOrder: generateSortOrder(existing), enabled: true }]
	});

	return mod;
}

export async function updateModule(id: string, changes: Partial<ModuleContent>) {
	const updated = await ModuleService.update(id, changes);
	if (updated) {
		modules.update((list) => list.map((m) => (m.id === id ? updated : m)));
	}
}

export async function deleteModule(id: string) {
	const settings = get(appSettings);
	if (!settings) return;

	await ModuleService.delete(id);
	await updateSettings({
		moduleRefs: (settings.moduleRefs || []).filter((r) => r.id !== id)
	});

	modules.update((list) => list.filter((m) => m.id !== id));
	moduleResources.update((map) => { const m = new Map(map); m.delete(id); return m; });
}

// ─── Module-owned Lorebook CRUD ─────────────────────────────────────

export async function createModuleLorebook(moduleId: string, fields: LorebookFields) {
	const lb = await LorebookService.create(moduleId, fields);

	// Update module's lorebookRefs
	const mod = get(modules).find((m) => m.id === moduleId);
	if (mod) {
		const existing = mod.lorebookRefs ?? [];
		const lorebookRefs: OrderedRef[] = [...existing, { id: lb.id, sortOrder: generateSortOrder(existing) }];
		await ModuleService.update(moduleId, { lorebookRefs });
		modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, lorebookRefs } : m)));
	}

	// Update moduleResources cache
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId) ?? { lorebooks: [], scripts: [] };
		m.set(moduleId, { ...entry, lorebooks: [...entry.lorebooks, lb] });
		return m;
	});

	return lb;
}

export async function deleteModuleLorebook(moduleId: string, lorebookId: string) {
	await LorebookService.delete(lorebookId);

	// Update module's lorebookRefs
	const mod = get(modules).find((m) => m.id === moduleId);
	if (mod) {
		const lorebookRefs = (mod.lorebookRefs ?? []).filter((r) => r.id !== lorebookId);
		await ModuleService.update(moduleId, { lorebookRefs });
		modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, lorebookRefs } : m)));
	}

	// Update moduleResources cache
	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId);
		if (entry) m.set(moduleId, { ...entry, lorebooks: entry.lorebooks.filter((lb) => lb.id !== lorebookId) });
		return m;
	});
}

// ─── Module-owned Script CRUD ───────────────────────────────────────

export async function createModuleScript(moduleId: string, fields: ScriptFields) {
	const sc = await ScriptService.create(moduleId, fields);

	const mod = get(modules).find((m) => m.id === moduleId);
	if (mod) {
		const existing = mod.scriptRefs ?? [];
		const scriptRefs: OrderedRef[] = [...existing, { id: sc.id, sortOrder: generateSortOrder(existing) }];
		await ModuleService.update(moduleId, { scriptRefs });
		modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, scriptRefs } : m)));
	}

	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId) ?? { lorebooks: [], scripts: [] };
		m.set(moduleId, { ...entry, scripts: [...entry.scripts, sc] });
		return m;
	});

	return sc;
}

export async function deleteModuleScript(moduleId: string, scriptId: string) {
	await ScriptService.delete(scriptId);

	const mod = get(modules).find((m) => m.id === moduleId);
	if (mod) {
		const scriptRefs = (mod.scriptRefs ?? []).filter((r) => r.id !== scriptId);
		await ModuleService.update(moduleId, { scriptRefs });
		modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, scriptRefs } : m)));
	}

	moduleResources.update((map) => {
		const m = new Map(map);
		const entry = m.get(moduleId);
		if (entry) m.set(moduleId, { ...entry, scripts: entry.scripts.filter((s) => s.id !== scriptId) });
		return m;
	});
}

// ─── Module-owned Folder & Item Management ──────────────────────

export type ModuleFolderType = 'lorebooks' | 'scripts';

export async function createModuleFolder(moduleId: string, folderType: ModuleFolderType, name: string, parentId?: string) {
	const mod = get(modules).find((m) => m.id === moduleId);
	if (!mod) return;

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const newFolder = {
		id: crypto.randomUUID(),
		name,
		sortOrder: generateSortOrder(typeFolders as any),
		parentId
	};

	const updatedFolders = {
		...folders,
		[folderType]: [...typeFolders, newFolder]
	};

	const result = await ModuleService.update(moduleId, { folders: updatedFolders });
	if (result) {
		modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders, updatedAt: result.updatedAt } : m)));
	}
	return newFolder;
}

export async function updateModuleFolder(moduleId: string, folderType: ModuleFolderType, folderId: string, changes: Partial<{name: string, color: string, parentId: string, sortOrder: string}>) {
	const mod = get(modules).find((m) => m.id === moduleId);
	if (!mod) return;

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const updatedTypeFolders = typeFolders.map((f: FolderDef) => f.id === folderId ? { ...f, ...changes } : f);
	
	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const result = await ModuleService.update(moduleId, { folders: updatedFolders });
	if (!result) return;
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders, updatedAt: result.updatedAt } : m)));
}

export async function deleteModuleFolder(moduleId: string, folderType: ModuleFolderType, folderId: string) {
	const mod = get(modules).find((m) => m.id === moduleId);
	if (!mod) return;

	const folders = mod.folders ?? {};
	const typeFolders = folders[folderType] ?? [];
	
	const updatedTypeFolders = typeFolders.filter((f: FolderDef) => f.id !== folderId);
	
	const updatedFolders = {
		...folders,
		[folderType]: updatedTypeFolders
	};

	const result = await ModuleService.update(moduleId, { folders: updatedFolders });
	if (!result) return;
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, folders: updatedFolders, updatedAt: result.updatedAt } : m)));
}

export async function moveModuleItem(moduleId: string, folderType: ModuleFolderType, itemId: string, newFolderId?: string, newSortOrder?: string) {
	const mod = get(modules).find((m) => m.id === moduleId);
	if (!mod) return;

	let refKey: keyof typeof mod;
	switch (folderType) {
		case 'lorebooks': refKey = 'lorebookRefs'; break;
		case 'scripts': refKey = 'scriptRefs'; break;
		default: return;
	}

	const refs = (mod[refKey] as OrderedRef[]) ?? [];
	const updatedRefs = refs.map(ref => {
		if (ref.id !== itemId) return ref;
		return {
			...ref,
			folderId: newFolderId,
			sortOrder: newSortOrder ?? ref.sortOrder
		};
	});

	const result = await ModuleService.update(moduleId, { [refKey]: updatedRefs });
	if (!result) return;
	modules.update((list) => list.map((m) => (m.id === moduleId ? { ...m, [refKey]: updatedRefs, updatedAt: result.updatedAt } : m)));
}
