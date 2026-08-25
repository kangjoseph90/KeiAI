import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMMessage, LLMStreamOptions } from '$lib/llm/types';
import { resolveLLM } from '$lib/managers/llm';
import { strToU8, zipSync } from 'fflate';

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
            capabilities: ['audio_input', 'video_input', 'file_input']
        });
    });

    it('applies only declared model capabilities before invoking the handler', async () => {
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

    it('raises a visible error when a model cannot accept a native file', async () => {
        mocks.selectLLMHandler.mockReturnValue({
            handler: { stream: mocks.stream },
            capabilities: ['image_input', 'audio_input', 'video_input', 'streaming', 'tool_call']
        });
        const llm = await resolveLLM('chat', 'preset-1');
        const consume = async () => {
            for await (const _ of llm.stream(
                [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'file',
                                name: 'report.pdf',
                                mimeType: 'application/pdf',
                                data: 'AQID'
                            }
                        ]
                    }
                ],
                new AbortController().signal
            )) {
                // Consume the stream.
            }
        };

        await expect(consume()).rejects.toMatchObject({
            code: 'INVALID_INPUT',
            message: 'The selected model does not support file attachments: report.pdf'
        });
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it('uses local Office text when a model cannot accept native files', async () => {
        mocks.selectLLMHandler.mockReturnValue({
            handler: { stream: mocks.stream },
            capabilities: ['image_input', 'audio_input', 'video_input', 'streaming', 'tool_call']
        });
        const bytes = zipSync({
            'word/document.xml': strToU8(
                '<w:document><w:body><w:p><w:r><w:t>Local fallback</w:t></w:r></w:p></w:body></w:document>'
            )
        });
        const llm = await resolveLLM('chat', 'preset-1');

        for await (const _ of llm.stream(
            [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'file',
                            name: 'report.docx',
                            mimeType:
                                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            data: Buffer.from(bytes).toString('base64')
                        }
                    ]
                }
            ],
            new AbortController().signal
        )) {
            // Consume the stream.
        }

        expect(mocks.stream).toHaveBeenCalledWith(
            [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: '<attachment file="report.docx">\nLocal fallback\n</attachment>'
                        }
                    ]
                }
            ],
            expect.any(AbortSignal),
            expect.any(Object)
        );
    });
});
