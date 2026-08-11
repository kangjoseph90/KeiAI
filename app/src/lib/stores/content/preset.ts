import { get } from 'svelte/store';
import { PresetService, type PresetFields, type Preset, type Script } from '$lib/services';
import {
    importPresetPackage as importPresetPackagePorter,
    type KeiPresetPackageV1
} from '$lib/porters/preset';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import type { FolderDef } from '$lib/types/refs';
import { presets, activePreset } from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { ToggleItem } from '$lib/types/toggle';
import type { ChatCommand } from '$lib/types/command';

/**
 * Returns preset from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getPreset(presetId: string): Promise<Preset | null> {
    const active = get(activePreset);
    if (active?.id === presetId) return active;
    const cached = presets.get(presetId);
    if (cached) return cached;
    return PresetService.get(presetId);
}

export function getActivePreset(): Preset | null {
    return get(activePreset);
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPresets(): Promise<void> {
    const settings = await getAppSettings();
    const list = await PresetService.list();
    presets.setAll(sortByRefs(list, settings.presets.refs));

    const active = settings.presetId
        ? list.find((preset) => preset.id === settings.presetId)
        : null;
}

export async function selectPreset(presetId: string): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    await updateSettings({ presetId: presetId });
}

export async function createPreset(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
    const settings = await getAppSettings();
    // Create Record in DB
    const preset = await PresetService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.presets.refs, settings.presets.folders);
    try {
        await updateSettings({
            presets: { refs: { [preset.id]: { id: preset.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await PresetService.delete(preset.id);
        throw error;
    }

    // Update Store
    presets.set(preset.id, preset);

    return preset;
}

export async function importPresetPackage(
    pkg: KeiPresetPackageV1,
    options: {
        select?: boolean;
    } = {}
): Promise<Preset> {
    const presetId = await importPresetPackagePorter(pkg);

    const preset = await PresetService.get(presetId);
    if (!preset) {
        throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    }

    const settings = await getAppSettings();
    const sortOrder = generateSortOrder(settings.presets.refs, settings.presets.folders);
    try {
        await updateSettings({
            presets: { refs: { [preset.id]: { id: preset.id, sortOrder } } }
        });
    } catch (error) {
        await PresetService.delete(preset.id);
        throw error;
    }

    presets.set(preset.id, preset);

    if (options.select) {
        await selectPreset(preset.id);
    }

    return preset;
}

export async function updatePreset(
    presetId: string,
    changes: DeepPartial<PresetFields>
): Promise<void> {
    const updated = await PresetService.update(presetId, changes);
    presets.set(presetId, updated);
}

export async function deletePreset(presetId: string): Promise<void> {
    if (presets.size <= 1) {
        throw new AppError('DELETE_LAST_ITEM', 'Cannot delete the last preset.');
    }

    const settings = await getAppSettings();
    const isActivePreset = get(activePreset)?.id === presetId;

    // Capture ref for potential rollback
    const existingRef = settings.presets.refs[presetId];

    // Remove from parent's refs
    await updateSettings({ presets: { refs: { [presetId]: undefined } } });

    // Remove record from DB
    try {
        await PresetService.delete(presetId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ presets: { refs: { [presetId]: existingRef } } });
        throw error;
    }

    // Update Store
    presets.delete(presetId);

    // If deleting the active preset, select a fallback
    if (isActivePreset) {
        const fallback = get(presets).find((p) => p.id !== presetId);
        if (fallback) {
            await selectPreset(fallback.id);
        } else {
            await updateSettings({ presetId: undefined });
        }
    }
}

// ─── Preset-owned resources ────────────────────────────────────────────

export async function savePresetToggleItem(presetId: string, item: ToggleItem): Promise<void> {
    await updatePreset(presetId, { toggles: { refs: { [item.id]: item } } });
}

export async function deletePresetToggleItem(presetId: string, itemId: string): Promise<void> {
    await updatePreset(presetId, { toggles: { refs: { [itemId]: undefined } } });
}

export async function savePresetCommand(presetId: string, command: ChatCommand): Promise<void> {
    await updatePreset(presetId, { commands: { refs: { [command.id]: command } } });
}

export async function deletePresetCommand(presetId: string, commandId: string): Promise<void> {
    await updatePreset(presetId, { commands: { refs: { [commandId]: undefined } } });
}

export async function savePresetScript(presetId: string, item: Script): Promise<void> {
    await updatePreset(presetId, { scripts: { refs: { [item.id]: item } } });
}

export async function deletePresetScript(presetId: string, scriptId: string): Promise<void> {
    await updatePreset(presetId, { scripts: { refs: { [scriptId]: undefined } } });
}

// ─── Preset-owned Folder & Item Management ──────────────────────

export type PresetFolderType = 'scripts' | 'toggles' | 'commands';

export async function createPresetFolder(
    presetId: string,
    folderType: PresetFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder:
            sortOrder ?? generateSortOrder(preset[folderType].refs, preset[folderType].folders),
        parentId
    };

    await updatePreset(presetId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updatePresetFolder(
    presetId: string,
    folderType: PresetFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) return;

    const existing = preset[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updatePreset(presetId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deletePresetFolder(
    presetId: string,
    folderType: PresetFolderType,
    folderId: string
): Promise<void> {
    await updatePreset(presetId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function movePresetItem(
    presetId: string,
    folderType: PresetFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) return;

    const existing = preset[folderType].refs[itemId];
    if (!existing) return;

    await updatePreset(presetId, {
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
