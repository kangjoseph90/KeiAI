import { PluginService, type PluginFields, type Plugin } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import { plugins } from '../state';
import { getAppSettings, updateSettings } from './settings';
import type { DeepPartial } from '$lib/utils/defaults';

/**
 * Returns plugin from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getPlugin(pluginId: string): Promise<Plugin | null> {
    const cached = plugins.get(pluginId);
    if (cached) return cached;
    return PluginService.get(pluginId);
}

export async function loadPlugins(): Promise<void> {
    const settings = await getAppSettings();
    const list = await PluginService.list();
    plugins.setAll(sortByRefs(list, settings.plugins.refs));
}

export async function createPlugin(fields: DeepPartial<PluginFields> = {}): Promise<Plugin> {
    const settings = await getAppSettings();

    // Create Record in DB
    const plugin = await PluginService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.plugins.refs, settings.plugins.folders);
    try {
        await updateSettings({
            plugins: { refs: { [plugin.id]: { id: plugin.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await PluginService.delete(plugin.id);
        throw error;
    }

    // Update Store
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

    // Capture ref for potential rollback
    const existingRef = settings.plugins.refs[pluginId];

    // Remove from parent's refs
    await updateSettings({ plugins: { refs: { [pluginId]: undefined } } });

    // Remove record from DB
    try {
        await PluginService.delete(pluginId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ plugins: { refs: { [pluginId]: existingRef } } });
        throw error;
    }

    // Update Store
    plugins.delete(pluginId);
}
