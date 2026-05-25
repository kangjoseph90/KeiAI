import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager, type PluginInstance } from '$lib/plugins/manager';

function createInstance(pluginId: string): PluginInstance {
    return {
        pluginId,
        iframe: { remove: vi.fn() } as unknown as HTMLIFrameElement,
        transport: { destroy: vi.fn() } as unknown as PluginInstance['transport'],
        broker: {
            invoke: vi.fn().mockResolvedValue(undefined),
            fireEvent: vi.fn(),
            expose: vi.fn(),
            fire: vi.fn()
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map(),
        macroHandlers: new Map(),
        llmProviders: new Map(),
        llmTypes: new Map(),
        unloadHandlers: []
    };
}

// Helper to access private instances
function getInstances(manager: PluginManager): Map<string, PluginInstance> {
    return (manager as unknown as { instances: Map<string, PluginInstance> }).instances;
}

describe('PluginManager Unregistration RPC', () => {
    let manager: PluginManager;
    let instance: PluginInstance;
    const exposedHandlers = new Map<string, (...args: unknown[]) => void>();

    beforeEach(() => {
        manager = new PluginManager();
        instance = createInstance('test-plugin');
        getInstances(manager).set(instance.pluginId, instance);

        // Capture exposed handlers by spying on broker.expose
        vi.spyOn(instance.broker, 'expose').mockImplementation((id, fn) => {
            exposedHandlers.set(id, fn as (...args: unknown[]) => void);
        });

        // Call the private bindHostAPIs via type casting
        (manager as unknown as { bindHostAPIs: (i: PluginInstance) => void }).bindHostAPIs(
            instance
        );
    });

    it('handles core.offPipeline', () => {
        const offPipeline = exposedHandlers.get('core.offPipeline');
        expect(offPipeline).toBeDefined();

        instance.pipelineHandlers.set('pre-process', [
            { fnId: 'id1', order: 100 },
            { fnId: 'id2', order: 100 }
        ]);

        offPipeline!('pre-process', 'id1');
        const handlers = instance.pipelineHandlers.get('pre-process');
        expect(handlers).toHaveLength(1);
        expect(handlers![0].fnId).toBe('id2');
    });

    it('handles core.offEvent', () => {
        const offEvent = exposedHandlers.get('core.offEvent');
        expect(offEvent).toBeDefined();

        instance.eventListeners.set('evt1', ['id1', 'id2']);

        offEvent!('evt1', 'id1');
        const listeners = instance.eventListeners.get('evt1');
        expect(listeners).toHaveLength(1);
        expect(listeners![0]).toBe('id2');
    });

    it('handles core.offMacro with fnId verification', () => {
        const offMacro = exposedHandlers.get('core.offMacro');
        expect(offMacro).toBeDefined();

        instance.macroHandlers.set('macro1', { fnId: 'id1', recursive: false });

        // Try to delete with wrong fnId
        offMacro!('macro1', 'wrong_id');
        expect(instance.macroHandlers.has('macro1')).toBe(true);

        // Delete with correct fnId
        offMacro!('macro1', 'id1');
        expect(instance.macroHandlers.has('macro1')).toBe(false);
    });

    it('handles core.registerMacro with overwriting', () => {
        const registerMacro = exposedHandlers.get('core.registerMacro');
        expect(registerMacro).toBeDefined();

        registerMacro!('m1', 'id1', false);
        expect(instance.macroHandlers.get('m1')?.fnId).toBe('id1');

        registerMacro!('m1', 'id2', true);
        expect(instance.macroHandlers.get('m1')?.fnId).toBe('id2');
        expect(instance.macroHandlers.get('m1')?.recursive).toBe(true);
    });
});
