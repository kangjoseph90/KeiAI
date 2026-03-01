import { get } from 'svelte/store';
import {
	PromptPresetService,
	type PromptPresetSummaryFields,
	type PromptPresetDataFields
} from '../services/promptPreset.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import { promptPresets, activePreset, appSettings } from './state.js';

export async function loadPresets() {
	const settings = get(appSettings);
	const list = await PromptPresetService.list();
	if (settings?.presetRefs) {
		promptPresets.set(sortByRefs(list, settings.presetRefs));
	} else {
		promptPresets.set(list);
	}
}

export async function selectPreset(id: string) {
	activePreset.set(await PromptPresetService.getDetail(id));
}

export async function createPreset(
	fields: PromptPresetSummaryFields,
	data?: PromptPresetDataFields
) {
	const settings = get(appSettings);
	if (!settings) return;

	const detail = await PromptPresetService.create(fields, data);

	const existing = settings.presetRefs || [];
	const presetRefs = [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }];
	const updatedSettings = await SettingsService.update({ presetRefs });
	if (!updatedSettings) {
		await PromptPresetService.delete(detail.id);
		return;
	}

	promptPresets.update((list) => [...list, detail]);
	appSettings.set(updatedSettings);

	return detail;
}

export async function updatePresetSummary(id: string, changes: Partial<PromptPresetSummaryFields>) {
	const updated = await PromptPresetService.updateSummary(id, changes);
	if (updated) {
		promptPresets.update((list) => list.map((p) => (p.id === id ? updated : p)));
		activePreset.update((p) => (p && p.id === id ? { ...p, ...updated } : p));
	}
}

export async function updatePresetData(id: string, changes: Partial<PromptPresetDataFields>) {
	const result = await PromptPresetService.updateData(id, changes);
	if (result) {
		activePreset.update((p) =>
			p && p.id === id ? { ...p, data: result.data, updatedAt: result.updatedAt } : p
		);
	}
}

export async function updatePresetFull(
	id: string,
	summaryChanges: Partial<PromptPresetSummaryFields>,
	dataChanges: Partial<PromptPresetDataFields>
) {
	const result = await PromptPresetService.update(id, summaryChanges, dataChanges);
	if (!result) return;

	promptPresets.update((list) => list.map((p) => (p.id === id ? result : p)));
	activePreset.update((p) => (p && p.id === id ? result : p));
}

export async function deletePreset(id: string) {
	const settings = get(appSettings);
	if (!settings) return;

	const existingRefs = settings.presetRefs || [];
	const presetRefs = existingRefs.filter((r) => r.id !== id);
	const updatedSettings = await SettingsService.update({ presetRefs });
	if (!updatedSettings) return;

	try {
		await PromptPresetService.delete(id);
	} catch (error) {
		const rolledBackSettings = await SettingsService.update({ presetRefs: existingRefs });
		if (rolledBackSettings) appSettings.set(rolledBackSettings);
		throw error;
	}

	appSettings.set(updatedSettings);
	promptPresets.update((list) => list.filter((p) => p.id !== id));
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
	}
}
