import { describe, expect, it, vi } from 'vitest';
import { PluginLLMStreamHandler } from '$lib/llm/handlers/plugin';
import type { LLMMessage, LLMStreamContent } from '$lib/llm/types';
import type { PluginInstance } from '$lib/plugins';

describe('PluginLLMStreamHandler', () => {
    it('does not send thought parts to the plugin request', async () => {
        const invokeStream = vi.fn(
            (
                _fnId: string,
                _args: unknown[],
                _signal: AbortSignal
            ): AsyncIterable<LLMStreamContent> => responseStream()
        );
        const instance = {
            broker: { invokeStream }
        } as unknown as PluginInstance;
        const handler = new PluginLLMStreamHandler(
            { modelId: 'plugin-model' },
            instance,
            'generate'
        );
        const messages: LLMMessage[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'thought', text: 'private reasoning' },
                    { type: 'text', text: 'visible response' }
                ]
            },
            {
                role: 'assistant',
                content: [{ type: 'thought', text: 'thought-only message' }]
            }
        ];

        for await (const _state of handler.stream(messages, new AbortController().signal)) {
            // Drain the stream.
        }

        const call = invokeStream.mock.calls[0];
        expect(call).toBeDefined();
        if (!call) throw new Error('Plugin handler did not invoke the broker');
        const request = call[1][0] as LLMMessage[];
        expect(request).toEqual([
            {
                role: 'assistant',
                content: [{ type: 'text', text: 'visible response' }]
            }
        ]);
    });
});

async function* responseStream(): AsyncIterable<LLMStreamContent> {
    yield { parts: [{ type: 'text', text: 'ok' }] };
}
