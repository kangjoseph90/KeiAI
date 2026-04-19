import { get } from 'svelte/store';
import { PresetService, type PresetFields, type Preset } from '$lib/services/content/preset';
import { SettingsService } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { presets, activePreset, appSettings } from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';

/**
 * Returns preset from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getPreset(presetId: string): Promise<Preset> {
	const active = get(activePreset);
	if (active?.id === presetId) return active;
	const cached = presets.get(presetId);
	if (cached) return cached;
	const db = await PresetService.get(presetId);
	if (!db) throw new AppError('NOT_FOUND', `Preset not found: ${presetId}`);
	return db;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPresets(): Promise<void> {
	const settings = await getAppSettings();
	const list = await PresetService.list();
	if (settings?.presetRefs) {
		presets.setAll(sortByRefs(list, settings.presetRefs));
	} else {
		presets.setAll(list);
	}
}

export async function selectPreset(presetId: string): Promise<void> {
	const preset = await getPreset(presetId);
	activePreset.set(preset);
	appSettings.update((s) => (s ? { ...s, presetId: presetId } : s));
	await SettingsService.update({ presetId: presetId });
}

export async function createPreset(fields: DeepPartial<PresetFields> = {}): Promise<Preset> {
	const settings = await getAppSettings();

	// Create Record in DB
	const preset = await PresetService.create(fields);

	// Add to parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = [
		...existingRefs,
		{ id: preset.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await SettingsService.update({ presetRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await PresetService.delete(preset.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	presets.set(preset.id, preset);

	return preset;
}

export async function updatePreset(
	presetId: string,
	changes: DeepPartial<PresetFields>
): Promise<void> {
	const updated = await PresetService.update(presetId, changes);
	presets.set(presetId, updated);
	activePreset.update((p) => (p && p.id === presetId ? updated : p));
}

export async function deletePreset(presetId: string): Promise<void> {
	if (presets.size <= 1) {
		throw new AppError('DELETE_LAST_ITEM', 'Cannot delete the last preset.');
	}

	const settings = await getAppSettings();

	// Remove from parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = existingRefs.filter((r) => r.id !== presetId);

	// If deleting the active preset, select a fallback first
	const isActivePreset = get(activePreset)?.id === presetId;
	const fallback = isActivePreset ? get(presets).find((p) => p.id !== presetId) : undefined;

	await SettingsService.update({ presetRefs });

	// Remove record from DB
	try {
		await PresetService.delete(presetId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ presetRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	presets.delete(presetId);

	// Select fallback if the deleted preset was active
	if (fallback) {
		await selectPreset(fallback.id);
	} else if (isActivePreset) {
		activePreset.set(null);
	}
}
