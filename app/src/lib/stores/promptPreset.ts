import { get } from 'svelte/store';
import {
	PromptPresetService,
	type PromptPresetSummaryFields,
	type PromptPresetDataFields,
	type PromptPresetDetail
} from '../services/promptPreset.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import { promptPresets, activePreset, appSettings } from './state.js';
import { AppError } from '../errors.js';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPresets(): Promise<void> {
	const settings = get(appSettings);
	const list = await PromptPresetService.list();
	if (settings?.presetRefs) {
		promptPresets.set(sortByRefs(list, settings.presetRefs));
	} else {
		promptPresets.set(list);
	}
}

export async function selectPreset(id: string): Promise<void> {
	activePreset.set(await PromptPresetService.getDetail(id));

	// TODO: Update settings with selected preset
}

export async function createPreset(
	fields: Partial<PromptPresetSummaryFields>,
	data?: Partial<PromptPresetDataFields>
): Promise<PromptPresetDetail> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Create Record in DB
	const detail = await PromptPresetService.create(fields, data);

	// Add to parent's refs
	const existingRefs = settings.presetRefs || [];
	const presetRefs = [...existingRefs, { id: detail.id, sortOrder: generateSortOrder(existingRefs) }];
	try {
		await SettingsService.update({ presetRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await PromptPresetService.delete(detail.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	promptPresets.update((list) => [...list, detail]);

	return detail;
}

export async function updatePresetSummary(id: string, changes: Partial<PromptPresetSummaryFields>): Promise<void> {
	const updated = await PromptPresetService.updateSummary(id, changes);
	promptPresets.update((list) => list.map((p) => (p.id === id ? updated : p)));
	activePreset.update((p) => (p && p.id === id ? { ...p, ...updated } : p));
}

export async function updatePresetData(id: string, changes: Partial<PromptPresetDataFields>): Promise<void> {
	const data = await PromptPresetService.updateData(id, changes);
	activePreset.update((p) =>
		p && p.id === id ? { ...p, data } : p
	);
}

export async function updatePresetFull(
	id: string,
	summaryChanges: Partial<PromptPresetSummaryFields>,
	dataChanges: Partial<PromptPresetDataFields>
): Promise<void> {
	const result = await PromptPresetService.update(id, summaryChanges, dataChanges);
	promptPresets.update((list) => list.map((p) => (p.id === id ? result : p)));
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
		await PromptPresetService.delete(id);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ presetRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, presetRefs } : s));
	promptPresets.update((list) => list.filter((p) => p.id !== id));
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
	}
}
