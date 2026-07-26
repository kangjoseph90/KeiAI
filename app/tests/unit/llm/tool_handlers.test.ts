import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAILLMStreamHandler } from '$lib/llm/handlers/openai';
import { AnthropicLLMStreamHandler } from '$lib/llm/handlers/anthropic';
import { GoogleLLMStreamHandler } from '$lib/llm/handlers/google';
import type { LLMMessage, LLMStreamContent, LLMStreamHandler } from '$lib/llm/types';
import type { ToolDefinition } from '$lib/types/tools';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock('$lib/adapters/http', () => ({ appHttp: { fetch: mockFetch } }));

const tool: ToolDefinition = {
    id: 'file_read',
    name: 'file_read',
    description: 'Read an application file.',
    permission: 'read',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
    }
};

const messages: LLMMessage[] = [
    {
        role: 'assistant',
        content: [
            { type: 'text', text: 'I will read it.' },
            { type: 'thought', text: 'This must stay local until signatures are supported.' },
            {
                type: 'tool_request',
                callId: 'call-1',
                name: 'file_read',
                args: { path: 'notes.txt' }
            }
        ]
    },
    {
        role: 'user',
        content: [
            {
                type: 'tool_response',
                callId: 'call-1',
                name: 'file_read',
                content: [{ type: 'text', text: 'hello' }]
            }
        ]
    }
];

const config = {
    modelId: 'tool-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    useProxy: false
};

async function complete(handler: LLMStreamHandler): Promise<LLMStreamContent> {
    let result: LLMStreamContent = { parts: [] };
    for await (const state of handler.stream(messages, new AbortController().signal, {
        stream: false,
        tools: [tool]
    })) {
        result = state;
    }
    return result;
}

describe('tool-capable LLM handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('maps OpenAI tools, trace messages, and completion tool calls', async () => {
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: null,
                                reasoning_content: 'Checking the next file.',
                                tool_calls: [
                                    {
                                        id: 'call-2',
                                        function: {
                                            name: 'file_read',
                                            arguments: '{"path":"next.txt"}'
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                })
            )
        );

        const result = await complete(new OpenAILLMStreamHandler(config));
        const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);

        expect(body.tools[0].function.name).toBe('file_read');
        expect(body.messages).toEqual([
            {
                role: 'assistant',
                content: 'I will read it.',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'file_read', arguments: '{"path":"notes.txt"}' }
                    }
                ]
            },
            { role: 'tool', tool_call_id: 'call-1', content: 'hello' }
        ]);
        expect(result.parts).toEqual([
            { type: 'thought', text: 'Checking the next file.' },
            {
                type: 'tool_request',
                callId: 'call-2',
                name: 'file_read',
                args: { path: 'next.txt' }
            }
        ]);
    });

    it('maps Anthropic tools and tool blocks', async () => {
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    content: [
                        {
                            type: 'thinking',
                            thinking: 'Choosing the next file.'
                        },
                        {
                            type: 'tool_use',
                            id: 'call-2',
                            name: 'file_read',
                            input: { path: 'next.txt' }
                        }
                    ]
                })
            )
        );

        const result = await complete(new AnthropicLLMStreamHandler(config));
        const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);

        expect(body.tools[0].input_schema).toEqual(tool.inputSchema);
        expect(body.messages[0].content[1]).toEqual({
            type: 'tool_use',
            id: 'call-1',
            name: 'file_read',
            input: { path: 'notes.txt' }
        });
        expect(body.messages[1].content[0]).toEqual({
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: 'hello'
        });
        expect(result.parts).toEqual([
            { type: 'thought', text: 'Choosing the next file.' },
            {
                type: 'tool_request',
                callId: 'call-2',
                name: 'file_read',
                args: { path: 'next.txt' }
            }
        ]);
    });

    it('maps Gemini declarations, function parts, and completion calls', async () => {
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        functionCall: {
                                            id: 'call-2',
                                            name: 'file_read',
                                            args: { path: 'next.txt' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                })
            )
        );

        const result = await complete(new GoogleLLMStreamHandler(config));
        const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);

        expect(body.tools[0].functionDeclarations[0].name).toBe('file_read');
        expect(body.contents[0].parts[1]).toEqual({
            functionCall: { id: 'call-1', name: 'file_read', args: { path: 'notes.txt' } }
        });
        expect(body.contents[1].parts[0]).toEqual({
            functionResponse: {
                id: 'call-1',
                name: 'file_read',
                response: { output: 'hello' }
            }
        });
        expect(result.parts).toEqual([
            {
                type: 'tool_request',
                callId: 'call-2',
                name: 'file_read',
                args: { path: 'next.txt' }
            }
        ]);
    });
});
