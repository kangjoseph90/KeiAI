import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager, type PluginInstance } from '$lib/plugins/manager';
import { plugins } from '$lib/stores/state';

const { mockGetPlugin } = vi.hoisted(() => ({
    mockGetPlugin: vi.fn()
}));

vi.mock('$lib/stores/content/plugin', () => ({
    getPlugin: mockGetPlugin,
    updatePlugin: vi.fn()
}));

function createInstance(pluginId: string): PluginInstance {
    return {
        pluginId,
        iframe: { remove: vi.fn() } as unknown as HTMLIFrameElement,
        transport: { destroy: vi.fn() } as unknown as PluginInstance['transport'],
        broker: { invoke: vi.fn(), fireEvent: vi.fn() } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map()
    };
}

function exposeInstances(manager: PluginManager): Map<string, PluginInstance> {
    return (
        manager as unknown as {
            instances: Map<string, PluginInstance>;
        }
    ).instances;
}

describe('PluginManager lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        plugins.clear();
    });

    it('unloadPlugin destroys transport, removes iframe, and drops runtime state', () => {
        const manager = new PluginManager();
        const instance = createInstance('plugin-1');
        exposeInstances(manager).set('plugin-1', instance);

        manager.unloadPlugin('plugin-1');

        expect(instance.transport.destroy).toHaveBeenCalledOnce();
        expect(instance.iframe.remove).toHaveBeenCalledOnce();
        expect(manager.getInstances()).toEqual([]);
    });

    it('destroyAll unloads every running plugin', () => {
        const manager = new PluginManager();
        const first = createInstance('plugin-1');
        const second = createInstance('plugin-2');
        exposeInstances(manager).set(first.pluginId, first);
        exposeInstances(manager).set(second.pluginId, second);

        manager.destroyAll();

        expect(first.transport.destroy).toHaveBeenCalledOnce();
        expect(second.transport.destroy).toHaveBeenCalledOnce();
        expect(first.iframe.remove).toHaveBeenCalledOnce();
        expect(second.iframe.remove).toHaveBeenCalledOnce();
        expect(manager.getInstances()).toEqual([]);
    });

    it('syncActivePlugins mirrors enabled plugins from the plugin store', async () => {
        const manager = new PluginManager();
        const enabled = createInstance('enabled-plugin');
        const disabled = createInstance('disabled-plugin');
        exposeInstances(manager).set(enabled.pluginId, enabled);
        exposeInstances(manager).set(disabled.pluginId, disabled);

        plugins.set(enabled.pluginId, {
            id: enabled.pluginId,
            name: 'Enabled Plugin',
            description: '',
            version: '',
            enabled: true,
            code: '',
            args: {}
        });
        plugins.set(disabled.pluginId, {
            id: disabled.pluginId,
            name: 'Disabled Plugin',
            description: '',
            version: '',
            enabled: false,
            code: '',
            args: {}
        });

        await manager.syncActivePlugins();

        expect(enabled.transport.destroy).not.toHaveBeenCalled();
        expect(disabled.transport.destroy).toHaveBeenCalledOnce();
        expect(disabled.iframe.remove).toHaveBeenCalledOnce();
        expect(manager.getInstances().map((instance) => instance.pluginId)).toEqual([
            enabled.pluginId
        ]);
    });
});
