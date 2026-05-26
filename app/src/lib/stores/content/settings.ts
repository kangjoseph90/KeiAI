import { get } from 'svelte/store';
import { SettingsService, type AppSettings } from '$lib/services';
import { appSettings } from '../state';
import type { FolderDef } from '$lib/types/refs';
import { generateSortOrder } from '$lib/utils/ordering';
import { generateId } from '$lib/utils/id';
import type { DeepPartial } from '$lib/utils/defaults';
import type { CustomLLMModel } from '$lib/types/models/llm';

/**
 * Returns app settings from store cache first, then from DB if needed.
 * Ensure existence, create if needed.
 */
export async function getAppSettings(): Promise<AppSettings> {
    const active = get(appSettings);
    if (active) return active;
    return SettingsService.get();
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadSettings(): Promise<void> {
    appSettings.set(await SettingsService.get());
}

export async function updateSettings(changes: DeepPartial<AppSettings>): Promise<void> {
    const updated = await SettingsService.update(changes);
    appSettings.set(updated);
}

// ─── Custom LLM Model CRUD ──────────────────────────────────────────

export async function createCustomLLMModel(
    fields: DeepPartial<CustomLLMModel> & { sortOrder: string }
): Promise<string> {
    const { modelId, settings } = await SettingsService.createCustomLLMModel(fields);
    appSettings.set(settings);
    return modelId;
}

export async function updateCustomLLMModel(
    modelId: string,
    changes: DeepPartial<CustomLLMModel & { sortOrder: string }>
): Promise<void> {
    const updated = await SettingsService.updateCustomLLMModel(modelId, changes);
    appSettings.set(updated);
}

export async function deleteCustomLLMModel(modelId: string): Promise<void> {
    const updated = await SettingsService.deleteCustomLLMModel(modelId);
    appSettings.set(updated);
}

// ─── Global Folder & Item Management ──────────────────────

export type GlobalFolderType =
    | 'rooms'
    | 'multiRooms'
    | 'characters'
    | 'personas'
    | 'presets'
    | 'modules'
    | 'plugins';

export async function createGlobalFolder(
    folderType: GlobalFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const settings = await getAppSettings();

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder:
            sortOrder ?? generateSortOrder(settings[folderType].refs, settings[folderType].folders),
        parentId
    };

    await updateSettings({
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });
    return newFolder;
}

export async function updateGlobalFolder(
    folderType: GlobalFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const settings = await getAppSettings();

    const existing = settings[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updateSettings({
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deleteGlobalFolder(
    folderType: GlobalFolderType,
    folderId: string
): Promise<void> {
    await updateSettings({
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function moveGlobalItem(
    folderType: GlobalFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const settings = await getAppSettings();

    const existing = settings[folderType].refs[itemId];
    if (!existing) return;

    await updateSettings({
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
