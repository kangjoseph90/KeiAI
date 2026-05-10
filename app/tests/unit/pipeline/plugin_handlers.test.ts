import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPipelineHandlers } from '$lib/pipeline/handler';
import type { PluginInstance } from '$lib/plugins/manager';

const { mockGetMergedScripts, mockCollectCharJSInstances, mockPluginManager } = vi.hoisted(() => ({
    mockGetMergedScripts: vi.fn(),
    mockCollectCharJSInstances: vi.fn(),
    mockPluginManager: {
        getInstances: vi.fn()
    }
}));

vi.mock('$lib/stores', () => ({
    getMergedScripts: mockGetMergedScripts
}));

vi.mock('$lib/charjs', () => ({
    collectCharJSInstances: mockCollectCharJSInstances,
    invokeHandler: vi.fn()
}));

vi.mock('$lib/plugins', () => ({
    pluginManager: mockPluginManager
}));

function createPluginInstance(): PluginInstance {
    return {
        pluginId: 'plugin-1',
        iframe: {} as HTMLIFrameElement,
        transport: {} as PluginInstance['transport'],
        broker: {
            invoke: vi.fn(async (_fnId: string, args: unknown[]) => `${String(args[0])}:plugin`)
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map([
            [
                'output',
                [
                    {
                        fnId: 'transform-output',
                        order: 25
                    }
                ]
            ]
        ]),
        eventListeners: new Map(),
        macroHandlers: new Map(),
        unloadHandlers: []
    };
}

describe('pipeline plugin handler integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetMergedScripts.mockResolvedValue([]);
        mockCollectCharJSInstances.mockResolvedValue([]);
    });

    it('collects plugin pipeline handlers from active plugin instances', async () => {
        const instance = createPluginInstance();
        mockPluginManager.getInstances.mockReturnValue([instance]);
        const context = {
            chatId: 'chat-1',
            characterId: 'character-1',
            messageId: 'message-1',
            messageIndex: 0,
            role: 'assistant' as const
        };

        const handlers = await collectPipelineHandlers('chat-1', 'output');
        const result = await handlers[0].run('draft', context);

        expect(handlers).toHaveLength(1);
        expect(handlers[0].id).toBe('plugin:plugin-1:transform-output:output');
        expect(handlers[0].order).toBe(25);
        expect(instance.broker.invoke).toHaveBeenCalledWith('transform-output', ['draft', context]);
        expect(result).toBe('draft:plugin');
    });

    it('keeps previous pipeline data when a plugin handler returns undefined', async () => {
        const instance = createPluginInstance();
        vi.mocked(instance.broker.invoke).mockResolvedValue(undefined);
        mockPluginManager.getInstances.mockReturnValue([instance]);
        const context = {
            chatId: 'chat-1',
            characterId: 'character-1',
            messageId: 'message-1',
            messageIndex: 0,
            role: 'assistant' as const
        };

        const handlers = await collectPipelineHandlers('chat-1', 'output');
        const result = await handlers[0].run('draft', context);

        expect(result).toBe('draft');
    });
});
