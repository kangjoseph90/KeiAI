import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager, type PluginInstance } from '$lib/plugins/manager';

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
        pluginName: `Plugin ${pluginId}`,
        iframe: { remove: vi.fn() } as unknown as HTMLIFrameElement,
        transport: { destroy: vi.fn() } as unknown as PluginInstance['transport'],
        broker: {
            invoke: vi.fn().mockResolvedValue(undefined),
            fireEvent: vi.fn()
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map(),
        macroHandlers: new Map(),
        llmProviders: new Map(),
        imageGenProviders: new Map(),
        ttsProviders: new Map(),
        sttProviders: new Map(),
        embeddingProviders: new Map(),
        rerankerProviders: new Map(),
        llmTypes: new Map(),
        unloadHandlers: []
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
    });

    it('unloadPlugin calls unload hooks, destroys transport, removes iframe, and drops runtime state', async () => {
        const manager = new PluginManager();
        const instance = createInstance('plugin-1');
        instance.unloadHandlers.push('unload-1', 'unload-2');
        exposeInstances(manager).set('plugin-1', instance);

        await manager.unloadPlugin('plugin-1');

        expect(instance.broker.invoke).toHaveBeenNthCalledWith(1, 'unload-1', []);
        expect(instance.broker.invoke).toHaveBeenNthCalledWith(2, 'unload-2', []);
        expect(instance.transport.destroy).toHaveBeenCalledOnce();
        expect(instance.iframe.remove).toHaveBeenCalledOnce();
        expect(manager.getInstances()).toEqual([]);
    });

    it('destroyAll unloads every running plugin', async () => {
        const manager = new PluginManager();
        const first = createInstance('plugin-1');
        const second = createInstance('plugin-2');
        exposeInstances(manager).set(first.pluginId, first);
        exposeInstances(manager).set(second.pluginId, second);

        await manager.destroyAll();

        expect(first.transport.destroy).toHaveBeenCalledOnce();
        expect(second.transport.destroy).toHaveBeenCalledOnce();
        expect(first.iframe.remove).toHaveBeenCalledOnce();
        expect(second.iframe.remove).toHaveBeenCalledOnce();
        expect(manager.getInstances()).toEqual([]);
    });

    it('reloadPlugin unloads the current runtime before loading a fresh one', async () => {
        const manager = new PluginManager();
        const instance = createInstance('plugin-1');
        exposeInstances(manager).set(instance.pluginId, instance);
        const loadSpy = vi.spyOn(manager, 'loadPlugin').mockResolvedValue(undefined);

        await manager.reloadPlugin(instance.pluginId);

        expect(instance.transport.destroy).toHaveBeenCalledOnce();
        expect(instance.iframe.remove).toHaveBeenCalledOnce();
        expect(loadSpy).toHaveBeenCalledWith(instance.pluginId);
    });
});
