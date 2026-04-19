import { PluginService, SettingsService, type PluginFields, type Plugin } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { plugins, appSettings } from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns plugin from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getPlugin(pluginId: string): Promise<Plugin> {
	const cached = plugins.get(pluginId);
	if (cached) return cached;
	const db = await PluginService.get(pluginId);
	if (!db) throw new AppError('NOT_FOUND', `Plugin not found: ${pluginId}`);
	return db;
}

export async function loadPlugins(): Promise<void> {
	const settings = await getAppSettings();
	const list = await PluginService.list();
	if (settings?.pluginRefs) {
		plugins.setAll(sortByRefs(list, settings.pluginRefs));
	} else {
		plugins.setAll(list);
	}
}

export async function createPlugin(fields: DeepPartial<PluginFields> = {}): Promise<Plugin> {
	const settings = await getAppSettings();

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
	plugins.set(plugin.id, plugin);

	return plugin;
}

export async function updatePlugin(
	pluginId: string,
	changes: DeepPartial<PluginFields>
): Promise<void> {
	const updated = await PluginService.update(pluginId, changes);
	plugins.set(pluginId, updated);
}

export async function deletePlugin(pluginId: string): Promise<void> {
	const settings = await getAppSettings();

	// Remove from parent's refs
	const existingRefs = settings.pluginRefs || [];
	const pluginRefs = existingRefs.filter((r) => r.id !== pluginId);
	await SettingsService.update({ pluginRefs });

	// Remove record from DB
	try {
		await PluginService.delete(pluginId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ pluginRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, pluginRefs } : s));
	plugins.delete(pluginId);
}
