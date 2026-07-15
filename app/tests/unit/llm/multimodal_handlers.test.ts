import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAILLMStreamHandler } from '$lib/llm/handlers/openai';
import { AnthropicLLMStreamHandler } from '$lib/llm/handlers/anthropic';
import { GoogleLLMStreamHandler } from '$lib/llm/handlers/google';
import type { LLMMessage } from '$lib/llm/types';

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

async function collectContent(handler: {
    stream: (
        input: LLMMessage[],
        signal: AbortSignal,
        options: { stream: false }
    ) => AsyncIterable<unknown>;
}): Promise<void> {
    for await (const _ of handler.stream(messages, new AbortController().signal, {
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
});
