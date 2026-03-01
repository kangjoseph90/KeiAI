import { get } from 'svelte/store';
import { PluginService, type PluginFields } from '../services/plugin.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import { plugins, appSettings } from './state.js';

export async function loadPlugins() {
	const settings = get(appSettings);
	const list = await PluginService.list();
	if (settings?.pluginRefs) {
		plugins.set(sortByRefs(list, settings.pluginRefs));
	} else {
		plugins.set(list);
	}
}

export async function createPlugin(fields: PluginFields) {
	const settings = get(appSettings);
	if (!settings) return;

	const plugin = await PluginService.create(fields);
	plugins.update((list) => [...list, plugin]);
	const existing = settings.pluginRefs || [];
	const pluginRefs = [
		...existing,
		{ id: plugin.id, sortOrder: generateSortOrder(existing), enabled: true }
	];
	const updatedSettings = await SettingsService.update({ pluginRefs });
	if (updatedSettings) appSettings.set(updatedSettings);

	return plugin;
}

export async function updatePlugin(id: string, changes: Partial<PluginFields>) {
	const updated = await PluginService.update(id, changes);
	if (updated) {
		plugins.update((list) => list.map((p) => (p.id === id ? updated : p)));
	}
}

export async function deletePlugin(id: string) {
	const settings = get(appSettings);
	if (!settings) return;

	await PluginService.delete(id);
	const pluginRefs = (settings.pluginRefs || []).filter((r) => r.id !== id);
	const updatedSettings = await SettingsService.update({ pluginRefs });
	if (updatedSettings) appSettings.set(updatedSettings);

	plugins.update((list) => list.filter((p) => p.id !== id));
}
