import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitEvent } from '$lib/events';
import type { PluginInstance } from '$lib/plugins/manager';

const { mockCollectCharJSInstances, mockPluginManager, mockIsSafeMode } = vi.hoisted(() => ({
    mockCollectCharJSInstances: vi.fn(),
    mockPluginManager: {
        getInstances: vi.fn()
    },
    mockIsSafeMode: vi.fn()
}));

vi.mock('$lib/charjs', () => ({
    collectCharJSInstances: mockCollectCharJSInstances,
    invokeHandler: vi.fn()
}));

vi.mock('$lib/plugins', () => ({
    pluginManager: mockPluginManager
}));

vi.mock('$lib/config', () => ({
    isSafeMode: mockIsSafeMode
}));

function createPluginInstance(): PluginInstance {
    return {
        pluginId: 'plugin-1',
        iframe: {} as HTMLIFrameElement,
        transport: {} as PluginInstance['transport'],
        broker: {
            fireEvent: vi.fn()
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map([
            ['message:sent', ['listener-1', 'listener-2']],
            ['other:event', ['other-listener']]
        ]),
        macroHandlers: new Map(),
        llmProviders: new Map(),
        llmTypes: new Map(),
        unloadHandlers: []
    };
}

describe('event plugin integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSafeMode.mockReturnValue(false);
        mockCollectCharJSInstances.mockResolvedValue([]);
    });

    it('fires matching plugin event listeners', async () => {
        const instance = createPluginInstance();
        mockPluginManager.getInstances.mockReturnValue([instance]);

        await emitEvent('chat-1', 'message:sent', { content: 'hello' });

        expect(instance.broker.fireEvent).toHaveBeenCalledTimes(2);
        expect(instance.broker.fireEvent).toHaveBeenNthCalledWith(1, 'listener-1', [
            { content: 'hello' }
        ]);
        expect(instance.broker.fireEvent).toHaveBeenNthCalledWith(2, 'listener-2', [
            { content: 'hello' }
        ]);
    });

    it('does not fire plugin listeners in safe mode', async () => {
        const instance = createPluginInstance();
        mockIsSafeMode.mockReturnValue(true);
        mockPluginManager.getInstances.mockReturnValue([instance]);

        await emitEvent('chat-1', 'message:sent', { content: 'hello' });

        expect(instance.broker.fireEvent).not.toHaveBeenCalled();
    });
});
