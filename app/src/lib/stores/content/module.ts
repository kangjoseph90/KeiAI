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
import {
    importModulePackage as importModulePackagePorter,
    type KeiModulePackageV1
} from '$lib/porters/module';
import type { FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    modules,
    activeModule,
    activeModuleId,
    moduleLorebooks,
    moduleScripts,
    moduleCharJS
} from '../state';
import { getAppSettings, updateSettings } from './settings';
import { get } from 'svelte/store';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';
import type { AssetFields } from '$lib/types/asset';
import type { ToggleItem } from '$lib/types/toggle';

let moduleSelectionVersion = 0;

/**
 * Returns module from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getModule(moduleId: string): Promise<Module | null> {
    const active = get(activeModule);
    if (active?.id === moduleId) return active;
    const cached = modules.get(moduleId);
    if (cached) return cached;
    const fetched = await ModuleService.get(moduleId);
    if (fetched) modules.set(moduleId, fetched);
    return fetched;
}

/**
 * Returns lorebooks owned by a module.
 * Uses store cache when available, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getModuleLorebooks(moduleId: string): Promise<Lorebook[]> {
    if (moduleId === get(activeModuleId)) {
        return get(moduleLorebooks);
    }
    const mod = await getModule(moduleId);
    if (!mod) return [];
    const results = await Promise.all(
        Object.keys(mod.lorebooks.refs).map((id) => LorebookService.get(id))
    );
    return results.filter((lb): lb is Lorebook => lb !== null);
}

/**
 * Returns scripts owned by a module.
 * Uses store cache when available, falls back to refs-based individual gets
 * (avoids listByOwner which bypasses the record buffer LRU cache).
 */
export async function getModuleScripts(moduleId: string): Promise<Script[]> {
    if (moduleId === get(activeModuleId)) {
        return get(moduleScripts);
    }
    const mod = await getModule(moduleId);
    if (!mod) return [];
    const results = await Promise.all(
        Object.keys(mod.scripts.refs).map((id) => ScriptService.get(id))
    );
    return results.filter((sc): sc is Script => sc !== null);
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadModules(): Promise<void> {
    const settings = await getAppSettings();
    const mods = await ModuleService.list();

    modules.setAll(sortByRefs(mods, settings.modules.refs));
}

export async function selectModule(
    moduleId: string,
    isContextCurrent: () => boolean = () => true
): Promise<void> {
    if (!isContextCurrent()) return;
    const version = ++moduleSelectionVersion;
    clearActiveModuleState();
    const isCurrent = () => version === moduleSelectionVersion && isContextCurrent();

    const mod = await getModule(moduleId);
    if (!isCurrent()) return;
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    modules.set(mod.id, mod);
    activeModuleId.set(mod.id);

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(moduleId),
        ScriptService.listByOwner(moduleId),
        CharJSService.listByOwner(moduleId)
    ]);
    if (!isCurrent()) return;

    moduleLorebooks.setAll(sortByRefs(lorebooks, mod.lorebooks.refs));
    moduleScripts.setAll(sortByRefs(scripts, mod.scripts.refs));
    moduleCharJS.setAll(sortByRefs(charjs, mod.charjs.refs));
}

export function clearActiveModule(): void {
    moduleSelectionVersion += 1;
    clearActiveModuleState();
}

function clearActiveModuleState(): void {
    activeModuleId.set(null);
    moduleLorebooks.clear();
    moduleScripts.clear();
    moduleCharJS.clear();
}

export async function createModule(fields: DeepPartial<ModuleFields> = {}): Promise<Module> {
    const settings = await getAppSettings();

    // Create Record in DB
    const mod = await ModuleService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.modules.refs, settings.modules.folders);
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

    return mod;
}

export async function importModulePackage(
    pkg: KeiModulePackageV1,
    options: {
        allowLightAssets?: boolean;
        select?: boolean;
    } = {}
): Promise<Module> {
    const moduleId = await importModulePackagePorter(pkg, {
        allowLightAssets: options.allowLightAssets
    });

    const mod = await ModuleService.get(moduleId);
    if (!mod) {
        throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
    }

    const settings = await getAppSettings();
    const sortOrder = generateSortOrder(settings.modules.refs, settings.modules.folders);
    try {
        await updateSettings({
            modules: { refs: { [mod.id]: { id: mod.id, sortOrder, enabled: true } } }
        });
    } catch (error) {
        await ModuleService.delete(mod.id);
        throw error;
    }

    modules.set(mod.id, mod);

    if (options.select) {
        await selectModule(mod.id);
    }

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

// ─── Module-owned Toggle CRUD ────────────────────────────────────────

export async function saveModuleToggleItem(moduleId: string, item: ToggleItem): Promise<void> {
    await updateModule(moduleId, { toggles: { refs: { [item.id]: item } } });
}

export async function deleteModuleToggleItem(moduleId: string, itemId: string): Promise<void> {
    await updateModule(moduleId, { toggles: { refs: { [itemId]: undefined } } });
}

export async function deleteModule(moduleId: string): Promise<void> {
    const settings = await getAppSettings();

    // Capture ref for potential rollback
    const existingRef = settings.modules.refs[moduleId];

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
    if (moduleId === get(activeModuleId)) {
        clearActiveModule();
    }
}

export async function setModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
    const settings = await getAppSettings();
    const existing = settings.modules.refs[moduleId];
    if (!existing) return;
    await updateSettings({
        modules: { refs: { [moduleId]: { ...existing, enabled } } }
    });
}

// ─── Module-owned Asset CRUD ────────────────────────────────────────

export async function createModuleAsset(
    moduleId: string,
    asset: File | AssetFields
): Promise<void> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    const sortOrder = generateSortOrder(mod.assets.refs, mod.assets.folders);
    const updated = await ModuleService.createAsset(moduleId, asset, sortOrder);
    modules.set(moduleId, updated);
}

export async function deleteModuleAsset(moduleId: string, assetId: string): Promise<void> {
    const updated = await ModuleService.deleteAsset(moduleId, assetId);
    modules.set(moduleId, updated);
}

// ─── Module-owned Lorebook CRUD ─────────────────────────────────────

export async function createModuleLorebook(
    moduleId: string,
    fields: DeepPartial<LorebookFields>
): Promise<Lorebook> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    // Create Record in DB
    const lb = await LorebookService.create(moduleId, fields);

    // Update parent's refs
    const sortOrder = generateSortOrder(mod.lorebooks.refs, mod.lorebooks.folders);
    try {
        await updateModule(moduleId, {
            lorebooks: { refs: { [lb.id]: { id: lb.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await LorebookService.delete(lb.id);
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleLorebooks.set(lb.id, lb);
    }

    return lb;
}

export async function updateModuleLorebook(
    moduleId: string,
    lorebookId: string,
    changes: DeepPartial<LorebookFields>
): Promise<void> {
    const updated = await LorebookService.update(lorebookId, changes);
    if (moduleId === get(activeModuleId)) {
        moduleLorebooks.set(lorebookId, updated);
    }
}

export async function deleteModuleLorebook(moduleId: string, lorebookId: string): Promise<void> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    // Capture ref for potential rollback
    const existingRef = mod.lorebooks.refs[lorebookId];

    // Remove from parent's refs
    await updateModule(moduleId, { lorebooks: { refs: { [lorebookId]: undefined } } });

    try {
        await LorebookService.delete(lorebookId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateModule(moduleId, { lorebooks: { refs: { [lorebookId]: existingRef } } });
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleLorebooks.delete(lorebookId);
    }
}

// ─── Module-owned Script CRUD ───────────────────────────────────────

export async function createModuleScript(
    moduleId: string,
    fields: DeepPartial<ScriptFields>
): Promise<Script> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    // Create Record in DB
    const sc = await ScriptService.create(moduleId, fields);

    // Update parent's refs
    const sortOrder = generateSortOrder(mod.scripts.refs, mod.scripts.folders);
    try {
        await updateModule(moduleId, {
            scripts: { refs: { [sc.id]: { id: sc.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await ScriptService.delete(sc.id);
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleScripts.set(sc.id, sc);
    }

    return sc;
}

export async function updateModuleScript(
    moduleId: string,
    scriptId: string,
    changes: DeepPartial<ScriptFields>
): Promise<void> {
    const updated = await ScriptService.update(scriptId, changes);
    if (moduleId === get(activeModuleId)) {
        moduleScripts.set(scriptId, updated);
    }
}

export async function deleteModuleScript(moduleId: string, scriptId: string): Promise<void> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    // Capture ref for potential rollback
    const existingRef = mod.scripts.refs[scriptId];

    // Remove from parent's refs
    await updateModule(moduleId, { scripts: { refs: { [scriptId]: undefined } } });

    try {
        await ScriptService.delete(scriptId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateModule(moduleId, { scripts: { refs: { [scriptId]: existingRef } } });
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleScripts.delete(scriptId);
    }
}

// ─── Module-owned CharJS CRUD ───────────────────────────────────────

export async function createModuleCharJS(
    moduleId: string,
    fields: DeepPartial<CharJSFields>
): Promise<CharJS> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    const cjs = await CharJSService.create(moduleId, fields);

    const sortOrder = generateSortOrder(mod.charjs.refs, mod.charjs.folders);
    try {
        await updateModule(moduleId, {
            charjs: { refs: { [cjs.id]: { id: cjs.id, sortOrder } } }
        });
    } catch (error) {
        await CharJSService.delete(cjs.id);
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleCharJS.set(cjs.id, cjs);
    }

    return cjs;
}

export async function updateModuleCharJS(
    moduleId: string,
    charjsId: string,
    changes: DeepPartial<CharJSFields>
): Promise<void> {
    const updated = await CharJSService.update(charjsId, changes);
    if (moduleId === get(activeModuleId)) {
        moduleCharJS.set(charjsId, updated);
    }
}

export async function deleteModuleCharJS(moduleId: string, charjsId: string): Promise<void> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    // Capture ref for potential rollback
    const existingRef = mod.charjs.refs[charjsId];

    // Remove from parent's refs
    await updateModule(moduleId, { charjs: { refs: { [charjsId]: undefined } } });

    try {
        await CharJSService.delete(charjsId);
    } catch (error) {
        await updateModule(moduleId, { charjs: { refs: { [charjsId]: existingRef } } });
        throw error;
    }

    if (moduleId === get(activeModuleId)) {
        moduleCharJS.delete(charjsId);
    }
}

// ─── Module-owned Folder & Item Management ──────────────────────

export type ModuleFolderType = 'lorebooks' | 'scripts' | 'charjs' | 'assets' | 'toggles';

export async function createModuleFolder(
    moduleId: string,
    folderType: ModuleFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const mod = await getModule(moduleId);
    if (!mod) throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: sortOrder ?? generateSortOrder(mod[folderType].refs, mod[folderType].folders),
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
    if (!mod) return;

    const existing = mod[folderType].folders[folderId];
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
    if (!mod) return;

    const existing = mod[folderType].refs[itemId];
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
