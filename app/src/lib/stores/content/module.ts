import {
    ModuleService,
    type ModuleFields,
    type ModuleContent,
    type Module,
    type Lorebook,
    type Script,
    type CharJS
} from '$lib/services';
import {
    importModulePackage as importModulePackagePorter,
    type KeiModulePackageV1
} from '$lib/porters/module';
import type { FolderDef } from '$lib/types/refs';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { modules, activeModule, activeModuleId } from '../state';
import { getAppSettings, updateSettings } from './settings';
import { get } from 'svelte/store';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';
import type { AssetFields } from '$lib/types/asset';
import type { ToggleItem } from '$lib/types/toggle';
import type { ChatCommand } from '$lib/types/command';

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
}

export function clearActiveModule(): void {
    moduleSelectionVersion += 1;
    clearActiveModuleState();
}

function clearActiveModuleState(): void {
    activeModuleId.set(null);
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

export async function saveModuleCommand(moduleId: string, command: ChatCommand): Promise<void> {
    await updateModule(moduleId, { commands: { refs: { [command.id]: command } } });
}

export async function deleteModuleCommand(moduleId: string, commandId: string): Promise<void> {
    await updateModule(moduleId, { commands: { refs: { [commandId]: undefined } } });
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

// ─── Module-owned resources ────────────────────────────────────────────

export async function saveModuleLorebook(moduleId: string, item: Lorebook): Promise<void> {
    await updateModule(moduleId, { lorebooks: { refs: { [item.id]: item } } });
}

export async function deleteModuleLorebook(moduleId: string, lorebookId: string): Promise<void> {
    await updateModule(moduleId, { lorebooks: { refs: { [lorebookId]: undefined } } });
}

export async function saveModuleScript(moduleId: string, item: Script): Promise<void> {
    await updateModule(moduleId, { scripts: { refs: { [item.id]: item } } });
}

export async function deleteModuleScript(moduleId: string, scriptId: string): Promise<void> {
    await updateModule(moduleId, { scripts: { refs: { [scriptId]: undefined } } });
}

export async function saveModuleCharJS(moduleId: string, item: CharJS): Promise<void> {
    await updateModule(moduleId, { charjs: { refs: { [item.id]: item } } });
}

export async function deleteModuleCharJS(moduleId: string, charjsId: string): Promise<void> {
    await updateModule(moduleId, { charjs: { refs: { [charjsId]: undefined } } });
}

// ─── Module-owned Folder & Item Management ──────────────────────

export type ModuleFolderType =
    | 'lorebooks'
    | 'scripts'
    | 'charjs'
    | 'assets'
    | 'toggles'
    | 'commands';

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
