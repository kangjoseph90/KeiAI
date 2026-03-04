import { get } from 'svelte/store';
import {
	PresetService,
	type PresetSummaryFields,
	type PresetDataFields,
	type PresetDetail
} from '../services/domain/preset.js';
import { SettingsService } from '../services/domain/index.js';
import { generateSortOrder, sortByRefs } from '../shared/ordering.js';
import { presets, activePreset, appSettings } from './state.js';
import { AppError } from '../shared/errors.js';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPresets(): Promise<void> {
	const settings = get(appSettings);
	const list = await PresetService.list();
	if (settings?.presetRefs) {
		presets.set(sortByRefs(list, settings.presetRefs));
	} else {
		presets.set(list);
	}
}

export async function selectPreset(id: string): Promise<void> {
	activePreset.set(await PresetService.getDetail(id));

	// TODO: Update settings with selected preset
}

export async function createPreset(
	fields: Partial<PresetSummaryFields>,
	data?: Partial<PresetDataFields>
): Promise<PresetDetail> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Create Record in DB
	const detail = await PresetService.create(fields, data);

	// Add to parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = [...existingRefs, { id: detail.id, sortOrder: generateSortOrder(existingRefs) }];
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

export async function updatePresetSummary(id: string, changes: Partial<PresetSummaryFields>): Promise<void> {
	const updated = await PresetService.updateSummary(id, changes);
	presets.update((list) => list.map((p) => (p.id === id ? updated : p)));
	activePreset.update((p) => (p && p.id === id ? { ...p, ...updated } : p));
}

export async function updatePresetData(id: string, changes: Partial<PresetDataFields>): Promise<void> {
	const data = await PresetService.updateData(id, changes);
	activePreset.update((p) =>
		p && p.id === id ? { ...p, data } : p
	);
}

export async function updatePresetFull(
	id: string,
	summaryChanges: Partial<PresetSummaryFields>,
	dataChanges: Partial<PresetDataFields>
): Promise<void> {
	const result = await PresetService.update(id, summaryChanges, dataChanges);
	presets.update((list) => list.map((p) => (p.id === id ? result : p)));
	activePreset.update((p) => (p && p.id === id ? result : p));
}

export async function deletePreset(id: string): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Remove from parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = existingRefs.filter((r) => r.id !== id);
	await SettingsService.update({ presetRefs });

	// Remove record from DB
	try {
		await PresetService.delete(id);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ presetRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	presets.update((list) => list.filter((p) => p.id !== id));
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
	}
}
