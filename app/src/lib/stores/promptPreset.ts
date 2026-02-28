import { get } from 'svelte/store';
import {
	PromptPresetService,
	type PromptPreset,
	type PromptPresetSummaryFields,
	type PromptPresetDataFields
} from '../services/promptPreset.js';
import { updateSettings } from './settings.js';
import { generateSortOrder, sortByRefs } from './ordering.js';
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

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { data: _data, ...summary } = detail;
	promptPresets.update((list) => [...list, summary as PromptPreset]);
	const existing = settings.presetRefs || [];
	await updateSettings({
		presetRefs: [...existing, { id: detail.id, sortOrder: generateSortOrder(existing) }]
	});

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
			p && p.id === id ? { ...p, data: { ...p.data, ...changes }, updatedAt: result.updatedAt } : p
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

	if (result.summary) {
		promptPresets.update((list) =>
			list.map((p) => (p.id === id ? { ...p, ...result.summary, updatedAt: result.updatedAt } : p))
		);
	}
	activePreset.update((p) => {
		if (p && p.id === id) {
			return {
				...p,
				...(result.summary || {}),
				data: { ...p.data, ...(result.data || {}) },
				updatedAt: result.updatedAt
			};
		}
		return p;
	});
}

export async function deletePreset(id: string) {
	const settings = get(appSettings);
	if (!settings) return;

	await PromptPresetService.delete(id);
	await updateSettings({
		presetRefs: (settings.presetRefs || []).filter((r) => r.id !== id)
	});

	promptPresets.update((list) => list.filter((p) => p.id !== id));
	if (get(activePreset)?.id === id) {
		activePreset.set(null);
	}
}
