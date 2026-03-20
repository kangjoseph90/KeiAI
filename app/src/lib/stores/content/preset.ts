import { get } from 'svelte/store';
import {
	PresetService,
	type PresetSummaryFields,
	type PresetDataFields,
	type PresetDetail
} from '$lib/services/content/preset';
import { SettingsService } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { presets, activePreset, appSettings } from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';

export async function getPresetDetail(presetId: string): Promise<PresetDetail> {
	const active = get(activePreset);
	if (active?.id === presetId) return active;
	const db = await PresetService.getDetail(presetId);
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
		presets.set(sortByRefs(list, settings.presetRefs));
	} else {
		presets.set(list);
	}
}

export async function selectPreset(presetId: string): Promise<void> {
	const detail = await getPresetDetail(presetId);
	activePreset.set(detail);
	appSettings.update((s) => (s ? { ...s, presetId: presetId } : s));
	await SettingsService.update({ presetId: presetId });
}

export async function createPreset(
	summary: Partial<PresetSummaryFields> = {},
	data: Partial<PresetDataFields> = {}
): Promise<PresetDetail> {
	const settings = await getAppSettings();

	// Create Record in DB
	const detail = await PresetService.create(summary, data);

	// Add to parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = [
		...existingRefs,
		{ id: detail.id, sortOrder: generateSortOrder(existingRefs) }
	];
	try {
		await SettingsService.update({ presetRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await PresetService.delete(detail.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	presets.update((list) => [...list, detail]);

	return detail;
}

export async function updatePresetSummary(
	presetId: string,
	changes: Partial<PresetSummaryFields>
): Promise<void> {
	const updated = await PresetService.updateSummary(presetId, changes);
	presets.update((list) => list.map((p) => (p.id === presetId ? updated : p)));
	activePreset.update((p) => (p && p.id === presetId ? { ...p, ...updated } : p));
}

export async function updatePresetData(
	presetId: string,
	changes: Partial<PresetDataFields>
): Promise<void> {
	const data = await PresetService.updateData(presetId, changes);
	activePreset.update((p) => (p && p.id === presetId ? { ...p, data } : p));
}

export async function updatePresetFull(
	presetId: string,
	summaryChanges: Partial<PresetSummaryFields>,
	dataChanges: Partial<PresetDataFields>
): Promise<void> {
	const result = await PresetService.update(presetId, summaryChanges, dataChanges);
	presets.update((list) => list.map((p) => (p.id === presetId ? result : p)));
	activePreset.update((p) => (p && p.id === presetId ? result : p));
}

export async function deletePreset(presetId: string): Promise<void> {
	const settings = await getAppSettings();

	// Remove from parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = existingRefs.filter((r) => r.id !== presetId);
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
	presets.update((list) => list.filter((p) => p.id !== presetId));
	if (get(activePreset)?.id === presetId) {
		activePreset.set(null);
	}
}
