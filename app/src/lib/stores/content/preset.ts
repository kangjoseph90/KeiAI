import { get } from 'svelte/store';
import {
    PresetService,
    ScriptService,
    type PresetFields,
    type Preset,
    type PromptBlock,
    type PromptBlockFields,
    type PresetCustomToggle,
    type PresetCustomToggleFields,
    type ScriptFields,
    type Script,
    type PresetContent
} from '$lib/services';
import { importPresetFromKei, type KeiPresetPackageV1 } from '$lib/porters/preset';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import type { FolderDef } from '$lib/types/refs';
import { presets, activePreset, presetScripts } from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';

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

export async function getPresetScripts(presetId: string): Promise<Script[]> {
    if (get(activePreset)?.id === presetId) {
        return get(presetScripts);
    }
    const preset = await getPreset(presetId);
    if (!preset) return [];
    const results = await Promise.all(
        Object.keys(preset.scripts.refs).map((id) => ScriptService.get(id))
    );
    return results.filter((sc): sc is Script => sc !== null);
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
    if (active) {
        const scripts = await ScriptService.listByOwner(active.id);
        presetScripts.setAll(sortByRefs(scripts, active.scripts.refs));
    } else {
        presetScripts.clear();
    }
}

export async function selectPreset(presetId: string): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    const resolved = await resolveGlobalVariables(preset.id, preset);
    await updateSettings({ presetId: presetId });

    const scripts = await ScriptService.listByOwner(presetId);
    presetScripts.setAll(sortByRefs(scripts, resolved.scripts.refs));
}

export async function createPreset(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
    const settings = await getAppSettings();
    const baseGlobals = getActivePreset()?.globalVariables ?? {};

    // Create Record in DB
    const preset = await PresetService.create({
        ...fields,
        globalVariables: {
            ...baseGlobals,
            ...(fields.globalVariables ?? {})
        }
    });
    const resolvedPreset = await resolveGlobalVariables(preset.id, preset);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.presets.refs);
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
    presets.set(resolvedPreset.id, resolvedPreset);

    return resolvedPreset;
}

export async function importPresetPackage(
    pkg: KeiPresetPackageV1,
    options: {
        select?: boolean;
    } = {}
): Promise<Preset> {
    const baseGlobals = getActivePreset()?.globalVariables ?? {};
    const presetId = await importPresetFromKei({
        ...pkg,
        preset: {
            ...pkg.preset,
            globalVariables: {
                ...baseGlobals,
                ...pkg.preset.globalVariables
            }
        }
    });

    const preset = await PresetService.get(presetId);
    if (!preset) {
        throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
    }

    const settings = await getAppSettings();
    const sortOrder = generateSortOrder(settings.presets.refs);
    try {
        await updateSettings({
            presets: { refs: { [preset.id]: { id: preset.id, sortOrder } } }
        });
    } catch (error) {
        await PresetService.delete(preset.id);
        throw error;
    }

    const resolvedPreset = await resolveGlobalVariables(preset.id, preset);
    presets.set(resolvedPreset.id, resolvedPreset);

    if (options.select) {
        await selectPreset(resolvedPreset.id);
    }

    return resolvedPreset;
}

export async function updatePreset(
    presetId: string,
    changes: DeepPartial<PresetFields>
): Promise<void> {
    const updated = await PresetService.update(presetId, changes);
    presets.set(presetId, updated);
    if (get(activePreset)?.id === presetId) {
        presetScripts.setAll(sortByRefs(get(presetScripts), updated.scripts.refs));
    }
}

export async function updatePresetContent(
    presetId: string,
    changes: DeepPartial<PresetContent>
): Promise<void> {
    const updated = await PresetService.updateContent(presetId, changes);
    presets.set(presetId, updated);
}

export async function resolveGlobalVariables(
    presetId: string,
    preset: Preset | null = null
): Promise<Preset> {
    const current = preset ?? (await getPreset(presetId));
    if (!current) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);

    const globalVariables = { ...current.globalVariables };
    for (const toggle of Object.values(current.customToggles)) {
        if (!('key' in toggle) || !toggle.key) continue;
        const key = `toggle_${toggle.key}`;
        if (globalVariables[key] !== undefined) continue;
        globalVariables[key] =
            toggle.type === 'select' ? '0' : toggle.type === 'checkbox' ? '0' : '';
    }

    const updated = await PresetService.updateContent(presetId, { globalVariables });
    presets.set(presetId, updated);
    return updated;
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
            presetScripts.clear();
        }
    }
}

// ─── Block Actions ───────────────────────────────────────────────────

export async function createPromptBlock(
    presetId: string,
    fields: DeepPartial<PromptBlockFields> & { sortOrder: string }
): Promise<string> {
    const { blockId, preset } = await PresetService.createBlock(presetId, fields);

    // Update Store
    presets.set(presetId, preset);

    return blockId;
}

export async function updatePromptBlock(
    presetId: string,
    blockId: string,
    changes: DeepPartial<PromptBlock>
): Promise<void> {
    const updated = await PresetService.updateBlock(presetId, blockId, changes);

    // Update Store
    presets.set(presetId, updated);
}

export async function deletePromptBlock(presetId: string, blockId: string): Promise<void> {
    const updated = await PresetService.deleteBlock(presetId, blockId);

    // Update Store
    presets.set(presetId, updated);
}

export async function createPresetCustomToggle(
    presetId: string,
    fields: DeepPartial<PresetCustomToggleFields> & { sortOrder: string }
): Promise<string> {
    const { toggleId, preset } = await PresetService.createCustomToggle(presetId, fields);
    const updated = await resolveGlobalVariables(presetId, preset);
    presets.set(presetId, updated);
    return toggleId;
}

export async function updatePresetCustomToggle(
    presetId: string,
    toggleId: string,
    changes: DeepPartial<PresetCustomToggle>
): Promise<void> {
    const preset = await PresetService.updateCustomToggle(presetId, toggleId, changes);
    const updated = await resolveGlobalVariables(presetId, preset);
    presets.set(presetId, updated);
}

export async function deletePresetCustomToggle(presetId: string, toggleId: string): Promise<void> {
    const updated = await PresetService.deleteCustomToggle(presetId, toggleId);
    presets.set(presetId, updated);
}

// ─── Preset-owned Script CRUD ───────────────────────────────────────

export async function createPresetScript(
    presetId: string,
    fields: DeepPartial<ScriptFields>
): Promise<Script> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);

    // Create Record in DB
    const sc = await ScriptService.create(presetId, fields);

    // Update parent's refs
    const sortOrder = generateSortOrder(preset.scripts.refs);
    try {
        await updatePreset(presetId, {
            scripts: { refs: { [sc.id]: { id: sc.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await ScriptService.delete(sc.id);
        throw error;
    }

    if (get(activePreset)?.id === presetId) {
        presetScripts.set(sc.id, sc);
    }

    return sc;
}

export async function updatePresetScript(
    presetId: string,
    scriptId: string,
    changes: DeepPartial<ScriptFields>
): Promise<void> {
    const updated = await ScriptService.update(scriptId, changes);
    if (get(activePreset)?.id === presetId) {
        presetScripts.set(scriptId, updated);
    }
}

export async function deletePresetScript(presetId: string, scriptId: string): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);

    // Capture ref for potential rollback
    const existingRef = preset.scripts.refs[scriptId];

    // Remove from parent's refs
    await updatePreset(presetId, { scripts: { refs: { [scriptId]: undefined } } });

    try {
        await ScriptService.delete(scriptId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updatePreset(presetId, { scripts: { refs: { [scriptId]: existingRef } } });
        throw error;
    }

    if (get(activePreset)?.id === presetId) {
        presetScripts.delete(scriptId);
    }
}

// ─── Preset-owned Folder & Item Management ──────────────────────

export async function createPresetFolder(
    presetId: string,
    name: string,
    parentId?: string
): Promise<FolderDef> {
    const preset = await getPreset(presetId);
    if (!preset) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder: generateSortOrder(preset.scripts.folders),
        parentId
    };

    await updatePreset(presetId, {
        scripts: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updatePresetFolder(
    presetId: string,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) return;

    const existing = preset.scripts.folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updatePreset(presetId, {
        scripts: { folders: { [folderId]: updated } }
    });
}

export async function deletePresetFolder(presetId: string, folderId: string): Promise<void> {
    await updatePreset(presetId, {
        scripts: { folders: { [folderId]: undefined } }
    });
}

export async function movePresetItem(
    presetId: string,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const preset = await getPreset(presetId);
    if (!preset) return;

    const existing = preset.scripts.refs[itemId];
    if (!existing) return;

    await updatePreset(presetId, {
        scripts: {
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
