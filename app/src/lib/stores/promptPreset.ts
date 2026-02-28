import { get } from 'svelte/store';
import { PromptPresetService, type PromptPreset, type PromptPresetDetail, type PromptPresetSummaryFields, type PromptPresetDataFields } from '../services/promptPreset.js';
import { updateSettings } from './settings.js';
import { generateSortOrder } from './ordering.js';
import { promptPresets, activePreset, appSettings } from './state.js';

export async function loadPresets() {
	promptPresets.set(await PromptPresetService.list());
}

export async function selectPreset(id: string) {
	activePreset.set(await PromptPresetService.getDetail(id));
}

export async function createPreset(
	fields: PromptPresetSummaryFields,
	data?: PromptPresetDataFields
) {
	const detail = await PromptPresetService.create(fields, data);

	const { data: _data, ...summary } = detail;
	promptPresets.update((list) => [...list, summary as PromptPreset]);

	const settings = get(appSettings);
	if (settings) {
		const existing = settings.presetRefs || [];
		await updateSettings({
			presetRefs: [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }]
		});
	}

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
		activePreset.update((p) => (p && p.id === id ? { ...p, data: { ...p.data, ...changes }, updatedAt: result.updatedAt } : p));
	}
}

export async function deletePreset(id: string) {
	await PromptPresetService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		await updateSettings({
			presetRefs: (settings.presetRefs || []).filter((r) => r.id !== id)
		});
	}

	promptPresets.update((list) => list.filter((p) => p.id !== id));
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
	}
}
