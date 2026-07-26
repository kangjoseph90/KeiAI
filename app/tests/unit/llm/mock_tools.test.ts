import { describe, expect, it } from 'vitest';
import { MockLLMStreamHandler } from '$lib/llm/handlers/mock';
import type { LLMMessage, LLMStreamContent } from '$lib/llm/types';
import type { ToolDefinition } from '$lib/types/tools';

const fileTools: ToolDefinition[] = [
    {
        id: 'file_write',
        name: 'file_write',
        description: 'Write a file.',
        permission: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', enum: ['global', 'room', 'chat'] },
                path: { type: 'string' },
                content: { type: 'string' }
            },
            required: ['namespace', 'path', 'content']
        }
    },
    {
        id: 'file_read',
        name: 'file_read',
        description: 'Read a file.',
        permission: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', enum: ['global', 'room', 'chat'] },
                path: { type: 'string' }
            },
            required: ['namespace', 'path']
        }
    }
];

describe('MockLLMStreamHandler file tools', () => {
    it('selects file_read and extracts its namespace and path', async () => {
        const result = await complete('room의 docs/notes.txt를 읽어줘');

        expect(result.parts.filter((part) => part.type === 'tool_request')).toEqual([
            {
                type: 'tool_request',
                callId: expect.stringMatching(/^mock_call_/),
                name: 'file_read',
                args: { namespace: 'room', path: 'docs/notes.txt' }
            }
        ]);
    });

    it('selects file_write and extracts quoted content', async () => {
        const result = await complete('전역 config/settings.txt에 "dark mode"를 저장해줘');

        expect(result.parts.filter((part) => part.type === 'tool_request')).toEqual([
            {
                type: 'tool_request',
                callId: expect.stringMatching(/^mock_call_/),
                name: 'file_write',
                args: {
                    namespace: 'global',
                    path: 'config/settings.txt',
                    content: 'dark mode'
                }
            }
        ]);
    });

    it('does not call a file tool for unrelated prompts', async () => {
        const result = await complete('오늘 날씨가 어때?');
        expect(result.parts.some((part) => part.type === 'tool_request')).toBe(false);
    });
});

async function complete(prompt: string): Promise<LLMStreamContent> {
    const messages: LLMMessage[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
    const handler = new MockLLMStreamHandler({ behavior: 'echo' });
    let result: LLMStreamContent = { parts: [] };
    for await (const chunk of handler.stream(messages, new AbortController().signal, {
        stream: false,
        tools: fileTools
    })) {
        result = chunk;
    }
    return result;
}
