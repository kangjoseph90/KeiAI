import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMMessage, LLMStreamOptions } from '$lib/llm/types';
import { resolveLLM } from '$lib/managers/llm';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    getPreset: vi.fn(),
    selectLLMHandler: vi.fn(),
    stream: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: mocks.getAppSettings
}));

vi.mock('$lib/stores/content/preset', () => ({
    getPreset: mocks.getPreset
}));

vi.mock('$lib/llm/handler', () => ({
    selectLLMHandler: mocks.selectLLMHandler
}));

describe('LLM manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAppSettings.mockResolvedValue({ presetId: 'preset-1' });
        mocks.getPreset.mockResolvedValue({
            models: {
                chat: { id: 'mock::echo', provider: 'mock', tokenizer: 'cl100k_base' }
            },
            parameters: {
                chat: { temperature: 0.5 }
            }
        });
        mocks.stream.mockImplementation(async function* () {
            yield { parts: [{ type: 'text', text: 'done' }] };
        });
        mocks.selectLLMHandler.mockReturnValue({
            handler: { stream: mocks.stream },
            unsupported: ['image_input', 'streaming', 'tool_call']
        });
    });

    it('applies model capabilities before invoking the handler', async () => {
        const messages: LLMMessage[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'image', data: 'image-data', mimeType: 'image/png' },
                    { type: 'tool_request', callId: 'call-1', name: 'search', args: {} }
                ]
            }
        ];
        const tools: NonNullable<LLMStreamOptions['tools']> = [
            {
                id: 'search',
                name: 'search',
                description: 'Search',
                permission: 'read',
                inputSchema: { type: 'object', properties: {} }
            }
        ];

        const llm = await resolveLLM('chat', 'preset-1');
        for await (const _state of llm.stream(messages, new AbortController().signal, {
            stream: true,
            tools
        })) {
            // Consume the stream.
        }

        expect(llm.tokenizer).toBe('cl100k_base');
        expect(mocks.stream).toHaveBeenCalledWith(
            [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'hello' },
                        { type: 'text', text: '[Image omitted: unsupported by model]' }
                    ]
                }
            ],
            expect.any(AbortSignal),
            {
                parameters: { temperature: 0.5 },
                maxResponse: undefined,
                stream: false,
                tools: undefined
            }
        );
    });
});
