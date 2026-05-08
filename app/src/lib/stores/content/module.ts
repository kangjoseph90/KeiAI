import {
    ModuleService,
    LorebookService,
    ScriptService,
    CharJSService,
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
import type { FolderDef, EntityListConfig } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { modules, moduleResources } from '../state';
import { EntityStore } from '../entity_store';
import { getAppSettings, updateSettings } from './settings';
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
 * Returns lorebooks owned by a module.
 * Uses store cache when available, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getModuleLorebooks(moduleId: string): Promise<Lorebook[]> {
    const entry = get(moduleResources).get(moduleId);
    if (entry) return get(entry.lorebooks);
    const mod = await getModule(moduleId);
    const refs = mod.lorebooks?.refs;
    if (!refs) return [];
    const results = await Promise.all(Object.keys(refs).map((id) => LorebookService.get(id)));
    return results.filter((lb): lb is Lorebook => lb !== null);
}

/**
 * Returns scripts owned by a module.
 * Uses store cache when available, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getModuleScripts(moduleId: string): Promise<Script[]> {
    const entry = get(moduleResources).get(moduleId);
    if (entry) return get(entry.scripts);
    const mod = await getModule(moduleId);
    const refs = mod.scripts?.refs;
    if (!refs) return [];
    const results = await Promise.all(Object.keys(refs).map((id) => ScriptService.get(id)));
    return results.filter((sc): sc is Script => sc !== null);
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadModules(): Promise<void> {
    const settings = await getAppSettings();
    const mods = await ModuleService.list();

    const refs = settings?.modules?.refs;
    if (refs) {
        modules.setAll(sortByRefs(mods, refs));
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
            lorebooksStore.setAll(sortByRefs(lorebooks, mod.lorebooks?.refs ?? {}));
            const scriptsStore = new EntityStore<Script>();
            scriptsStore.setAll(sortByRefs(scripts, mod.scripts?.refs ?? {}));
            const charjsStore = new EntityStore<CharJS>();
            charjsStore.setAll(sortByRefs(charjs, mod.charjs?.refs ?? {}));
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
    const refs = settings.modules?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
    try {
        await updateSettings({
            modules: { refs: { [mod.id]: { id: mod.id, sortOrder, enabled: true } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await ModuleService.delete(mod.id);
        throw error;
    }

    // Update Store
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
    changes: DeepPartial<ModuleFields>
): Promise<void> {
    const updated = await ModuleService.update(moduleId, changes);
    modules.set(moduleId, updated);
}

export async function updateModuleContent(
    moduleId: string,
    changes: DeepPartial<ModuleContent>
): Promise<void> {
    const updated = await ModuleService.update(moduleId, changes);
    modules.set(moduleId, updated);
}

export async function deleteModule(moduleId: string): Promise<void> {
    const settings = await getAppSettings();

    // Capture ref for potential rollback
    const existingRef = settings.modules?.refs?.[moduleId];

    // Remove from parent's refs
    await updateSettings({ modules: { refs: { [moduleId]: undefined } } });

    // Remove record from DB
    try {
        await ModuleService.delete(moduleId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ modules: { refs: { [moduleId]: existingRef } } });
        throw error;
    }

    // Update Store
    modules.delete(moduleId);
    moduleResources.update((map) => {
        const m = new Map(map);
        m.delete(moduleId);
        return m;
    });
}

export async function setModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
    const settings = await getAppSettings();
    const refs = settings.modules?.refs ?? {};
    const existing = refs[moduleId];
    if (!existing) return;
    await updateSettings({
        modules: { refs: { [moduleId]: { ...existing, enabled } } }
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
    const refs = mod.lorebooks?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
    try {
        await updateModule(moduleId, {
            lorebooks: { refs: { [lb.id]: { id: lb.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await LorebookService.delete(lb.id);
        throw error;
    }

    // Update Store
    get(moduleResources).get(moduleId)?.lorebooks.set(lb.id, lb);

    return lb;
}

export async function updateModuleLorebook(
    moduleId: string,
    lorebookId: string,
    changes: DeepPartial<LorebookFields>
): Promise<void> {
    const updated = await LorebookService.update(lorebookId, changes);
    get(moduleResources).get(moduleId)?.lorebooks.set(lorebookId, updated);
}

export async function deleteModuleLorebook(moduleId: string, lorebookId: string): Promise<void> {
    const mod = await getModule(moduleId);

    // Capture ref for potential rollback
    const existingRef = mod.lorebooks?.refs?.[lorebookId];

    // Remove from parent's refs
    await updateModule(moduleId, { lorebooks: { refs: { [lorebookId]: undefined } } });

    try {
        await LorebookService.delete(lorebookId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateModule(moduleId, { lorebooks: { refs: { [lorebookId]: existingRef } } });
        throw error;
    }

    // Update Store
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
    const refs = mod.scripts?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
    try {
        await updateModule(moduleId, {
            scripts: { refs: { [sc.id]: { id: sc.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await ScriptService.delete(sc.id);
        throw error;
    }

    // Update Store
    get(moduleResources).get(moduleId)?.scripts.set(sc.id, sc);

    return sc;
}

export async function updateModuleScript(
    moduleId: string,
    scriptId: string,
    changes: DeepPartial<ScriptFields>
): Promise<void> {
    const updated = await ScriptService.update(scriptId, changes);
    get(moduleResources).get(moduleId)?.scripts.set(scriptId, updated);
}

export async function deleteModuleScript(moduleId: string, scriptId: string): Promise<void> {
    const mod = await getModule(moduleId);

    // Capture ref for potential rollback
    const existingRef = mod.scripts?.refs?.[scriptId];

    // Remove from parent's refs
    await updateModule(moduleId, { scripts: { refs: { [scriptId]: undefined } } });

    try {
        await ScriptService.delete(scriptId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateModule(moduleId, { scripts: { refs: { [scriptId]: existingRef } } });
        throw error;
    }

    // Update Store
    get(moduleResources).get(moduleId)?.scripts.delete(scriptId);
}

// ─── Module-owned CharJS CRUD ───────────────────────────────────────

export async function createModuleCharJS(
    moduleId: string,
    fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
    const mod = await getModule(moduleId);

    const cjs = await CharJSService.create(moduleId, fields);

    const refs = mod.charjs?.refs ?? {};
    const sortOrder = generateSortOrder(refs);
    try {
        await updateModule(moduleId, {
            charjs: { refs: { [cjs.id]: { id: cjs.id, sortOrder } } }
        });
    } catch (error) {
        await CharJSService.delete(cjs.id);
        throw error;
    }

    // Update Store
    get(moduleResources).get(moduleId)?.charjs.set(cjs.id, cjs);

    return cjs;
}

export async function updateModuleCharJS(
    moduleId: string,
    charjsId: string,
    changes: DeepPartial<CharJSFields>
): Promise<void> {
    const updated = await CharJSService.update(charjsId, changes);
    get(moduleResources).get(moduleId)?.charjs.set(charjsId, updated);
}

export async function deleteModuleCharJS(moduleId: string, charjsId: string): Promise<void> {
    const mod = await getModule(moduleId);

    // Capture ref for potential rollback
    const existingRef = mod.charjs?.refs?.[charjsId];

    // Remove from parent's refs
    await updateModule(moduleId, { charjs: { refs: { [charjsId]: undefined } } });

    try {
        await CharJSService.delete(charjsId);
    } catch (error) {
        await updateModule(moduleId, { charjs: { refs: { [charjsId]: existingRef } } });
        throw error;
    }

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

    const config = mod[folderType] as EntityListConfig | undefined;
    const existingFolders = config?.folders ?? {};

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(existingFolders),
        parentId
    };

    await updateModule(moduleId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updateModuleFolder(
    moduleId: string,
    folderType: ModuleFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const mod = await getModule(moduleId);

    const config = mod[folderType] as EntityListConfig | undefined;
    const existingFolders = config?.folders ?? {};
    const existing = existingFolders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updateModule(moduleId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deleteModuleFolder(
    moduleId: string,
    folderType: ModuleFolderType,
    folderId: string
): Promise<void> {
    await updateModule(moduleId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function moveModuleItem(
    moduleId: string,
    folderType: ModuleFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const mod = await getModule(moduleId);

    const config = mod[folderType] as EntityListConfig | undefined;
    const refs = config?.refs ?? {};
    const existing = refs[itemId];
    if (!existing) return;

    await updateModule(moduleId, {
        [folderType]: {
            refs: {
                [itemId]: {
                    ...existing,
                    folderId: newFolderId,
                    sortOrder: newSortOrder ?? existing.sortOrder
                }
            }
        }
    });
}
