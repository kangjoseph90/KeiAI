import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { OpenAILLMStreamHandler } from '$lib/llm/handlers/openai';
import { AnthropicLLMStreamHandler } from '$lib/llm/handlers/anthropic';
import { GoogleLLMStreamHandler } from '$lib/llm/handlers/google';
import type { LLMMessage, LLMStreamContent } from '$lib/llm/types';
import { toBase64 } from '$lib/crypto';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock('$lib/adapters/http', () => ({
    appHttp: { fetch: mockFetch }
}));

const messages: LLMMessage[] = [
    { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    {
        role: 'user',
        content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', mimeType: 'image/webp', data: 'AQID' }
        ]
    }
];

const config = {
    modelId: 'vision-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    useProxy: false
};

async function collectContent(
    handler: {
        stream: (
            input: LLMMessage[],
            signal: AbortSignal,
            options: { stream: false }
        ) => AsyncIterable<unknown>;
    },
    input: LLMMessage[] = messages
): Promise<void> {
    for await (const _ of handler.stream(input, new AbortController().signal, {
        stream: false
    })) {
        // The request body is the assertion target.
    }
}

describe('multimodal LLM handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sends OpenAI-compatible image content unchanged', async () => {
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        );

        await collectContent(new OpenAILLMStreamHandler(config));

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            messages: Array<{ role: string; content: unknown }>;
        };
        expect(body.messages).toEqual([
            { role: 'system', content: 'You are helpful.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    { type: 'image_url', image_url: { url: 'data:image/webp;base64,AQID' } }
                ]
            }
        ]);
    });

    it('converts image data URLs to Anthropic base64 image blocks', async () => {
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }))
        );

        await collectContent(new AnthropicLLMStreamHandler(config));

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            system: string;
            messages: Array<{ role: string; content: unknown }>;
        };
        expect(body.system).toBe('You are helpful.');
        expect(body.messages).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    {
                        type: 'image',
                        source: { type: 'base64', media_type: 'image/webp', data: 'AQID' }
                    }
                ]
            }
        ]);
    });

    it('converts image data URLs to Gemini inline data parts', async () => {
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
        );

        await collectContent(new GoogleLLMStreamHandler(config));

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            systemInstruction: { parts: Array<{ text: string }> };
            contents: Array<{ role: string; parts: unknown }>;
        };
        expect(body.systemInstruction).toEqual({
            role: 'user',
            parts: [{ text: 'You are helpful.' }]
        });
        expect(body.contents).toEqual([
            {
                role: 'user',
                parts: [
                    { text: 'What is in this image?' },
                    { inlineData: { mimeType: 'image/webp', data: 'AQID' } }
                ]
            }
        ]);
    });

    it('serializes OpenAI-compatible audio input', async () => {
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        );
        const input: LLMMessage[] = [
            {
                role: 'user',
                content: [{ type: 'audio', mimeType: 'audio/mpeg', data: 'AQID' }]
            }
        ];

        await collectContent(new OpenAILLMStreamHandler(config), input);

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            messages: Array<{ content: unknown }>;
        };
        expect(body.messages[0].content).toEqual([
            { type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } }
        ]);
    });

    it('serializes Gemini audio and video as inline data', async () => {
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
        );
        const input: LLMMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'audio', mimeType: 'audio/ogg', data: 'audio' },
                    { type: 'video', mimeType: 'video/mp4', data: 'video' }
                ]
            }
        ];

        await collectContent(new GoogleLLMStreamHandler(config), input);

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            contents: Array<{ parts: unknown }>;
        };
        expect(body.contents[0].parts).toEqual([
            { inlineData: { mimeType: 'audio/ogg', data: 'audio' } },
            { inlineData: { mimeType: 'video/mp4', data: 'video' } }
        ]);
    });

    it('serializes provider-neutral PDF file parts for remote providers', async () => {
        const input: LLMMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', data: 'AQID' }
                ]
            }
        ];

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        );
        await collectContent(new OpenAILLMStreamHandler(config), input);
        let body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            messages: Array<{ content: unknown }>;
        };
        expect(body.messages[0].content).toEqual([
            {
                type: 'file',
                file: {
                    filename: 'report.pdf',
                    file_data: 'AQID'
                }
            }
        ]);

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }))
        );
        await collectContent(new AnthropicLLMStreamHandler(config), input);
        body = JSON.parse(vi.mocked(mockFetch).mock.calls[1][1].body as string) as {
            messages: Array<{ content: unknown }>;
        };
        expect(body.messages[0].content).toEqual([
            {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: 'AQID' }
            }
        ]);

        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
        );
        await collectContent(new GoogleLLMStreamHandler(config), input);
        const googleBody = JSON.parse(vi.mocked(mockFetch).mock.calls[2][1].body as string) as {
            contents: Array<{ parts: unknown }>;
        };
        expect(googleBody.contents[0].parts).toEqual([
            { inlineData: { mimeType: 'application/pdf', data: 'AQID' } }
        ]);
    });

    it('converts Gemini Office attachments to extracted text parts', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
        );
        const docx = zipSync({
            'word/document.xml': strToU8(
                '<w:document><w:body><w:p><w:r><w:t>Hello office</w:t></w:r></w:p></w:body></w:document>'
            )
        });
        const input: LLMMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'file',
                        name: 'report.docx',
                        mimeType:
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        data: toBase64(docx)
                    }
                ]
            }
        ];

        await collectContent(new GoogleLLMStreamHandler(config), input);

        const body = JSON.parse(vi.mocked(mockFetch).mock.calls[0][1].body as string) as {
            contents: Array<{ parts: unknown }>;
        };
        expect(body.contents[0].parts).toEqual([
            { text: '<attachment file="report.docx">\nHello office\n</attachment>' }
        ]);
    });

    it('preserves ordered text and generated media in Gemini output state', async () => {
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    { text: 'Planning', thought: true },
                                    { text: 'Before' },
                                    {
                                        inlineData: {
                                            mimeType: 'image/png',
                                            data: 'AQID'
                                        }
                                    },
                                    { text: 'After' }
                                ]
                            }
                        }
                    ]
                })
            )
        );

        let result: LLMStreamContent | undefined;
        for await (const state of new GoogleLLMStreamHandler(config).stream(
            messages,
            new AbortController().signal,
            { stream: false }
        )) {
            result = state;
        }

        expect(result).toEqual({
            parts: [
                { type: 'thought', text: 'Planning' },
                { type: 'text', text: 'Before' },
                { type: 'image', mimeType: 'image/png', data: 'AQID' },
                { type: 'text', text: 'After' }
            ]
        });
    });
});
