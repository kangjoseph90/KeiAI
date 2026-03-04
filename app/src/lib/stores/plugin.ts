import { get } from 'svelte/store';
import { PluginService, type PluginFields, type Plugin } from '../services/domain/plugin.js';
import { SettingsService } from '../services/domain/index.js';
import { generateSortOrder, sortByRefs } from '../shared/ordering.js';
import { plugins, appSettings } from './state.js';
import { AppError } from '../shared/errors.js';

export async function loadPlugins(): Promise<void> {
	const settings = get(appSettings);
	const list = await PluginService.list();
	if (settings?.pluginRefs) {
		plugins.set(sortByRefs(list, settings.pluginRefs));
	} else {
		plugins.set(list);
	}
}

export async function createPlugin(fields: Partial<PluginFields>): Promise<Plugin> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Create Record in DB
	const plugin = await PluginService.create(fields);

	// Add to parent's refs
	const existingRefs = settings.pluginRefs || [];
	const pluginRefs = [
		...existingRefs,
		{ id: plugin.id, sortOrder: generateSortOrder(existingRefs), enabled: true }
	];
	try {
		await SettingsService.update({ pluginRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await PluginService.delete(plugin.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, pluginRefs } : s));
	plugins.update((list) => [...list, plugin]);

	return plugin;
}

export async function updatePlugin(id: string, changes: Partial<PluginFields>): Promise<void> {
	const updated = await PluginService.update(id, changes);
	plugins.update((list) => list.map((p) => (p.id === id ? updated : p)));
}

export async function deletePlugin(id: string): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Remove from parent's refs
	const existingRefs = settings.pluginRefs || [];
	const pluginRefs = existingRefs.filter((r) => r.id !== id);
	await SettingsService.update({ pluginRefs });

	// Remove record from DB
	try {
		await PluginService.delete(id);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ pluginRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, pluginRefs } : s));
	plugins.update((list) => list.filter((p) => p.id !== id));
}
