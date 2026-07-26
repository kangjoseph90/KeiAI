import { describe, expect, it, vi } from 'vitest';
import {
    getWorkflowLLMTypes,
    serializeAgentParts,
    deserializeAgentParts,
    agentPartsToLLMMessages,
    findVisibleStartIndex,
    getLastTextPart,
    getVisibleParts,
    hasVisibleAgentOutput,
    type AgentPart
} from '$lib/workflow/agent/llm';
import { createDefaultChatWorkflow, createDefaultTranslationWorkflow } from '$lib/workflow';
import type { Chat } from '$lib/services';

const { mockGetToolCall } = vi.hoisted(() => ({ mockGetToolCall: vi.fn() }));

vi.mock('$lib/services/content/tool', () => ({
    ToolCallService: { get: mockGetToolCall }
}));

const chat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Test Chat',
    chatNote: '',
    messageCount: 0,
    personas: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    inlays: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} }
};

describe('serializeAgentParts', () => {
    it('serializes thought, text, inlay, and tool_calls parts with spaces preserved', () => {
        const parts: AgentPart[] = [
            { type: 'thought', text: '  thinking...  ' },
            { type: 'text', text: '\nHello World!\n' },
            { type: 'inlay', ids: ['image-1', 'audio-2'] },
            {
                type: 'tool_calls',
                calls: [{ id: 'call_1', name: 'search', status: 'pending' }]
            }
        ];
        const result = serializeAgentParts(parts);
        expect(result).toBe(
            '<|thought|>  thinking...  <|/thought|>\nHello World!\n<|inlay|>["image-1","audio-2"]<|/inlay|><|tool_calls|>[{"id":"call_1","name":"search","status":"pending"}]<|/tool_calls|>'
        );
    });

    it('returns empty string for empty parts array', () => {
        const result = serializeAgentParts([]);
        expect(result).toBe('');
    });
});

describe('deserializeAgentParts', () => {
    it('deserializes thought, text, inlay, and tool_calls parts correctly', () => {
        const serialized =
            '<|thought|>  thinking...  <|/thought|>\nHello World!\n<|inlay|>["image-1","audio-2"]<|/inlay|><|tool_calls|>[{"id":"call_1","name":"search","status":"running"}]<|/tool_calls|>';
        const result = deserializeAgentParts(serialized);
        expect(result).toEqual([
            { type: 'thought', text: '  thinking...  ' },
            { type: 'text', text: '\nHello World!\n' },
            { type: 'inlay', ids: ['image-1', 'audio-2'] },
            {
                type: 'tool_calls',
                calls: [{ id: 'call_1', name: 'search', status: 'running' }]
            }
        ]);
    });

    it('returns empty array for empty string', () => {
        const result = deserializeAgentParts('');
        expect(result).toEqual([]);
    });

    it('guarantees roundtrip serialization/deserialization', () => {
        const original: AgentPart[] = [
            { type: 'text', text: 'Start ' },
            { type: 'thought', text: 'inner thought' },
            { type: 'text', text: ' mid ' },
            { type: 'inlay', ids: ['asset-a', 'asset-b'] },
            {
                type: 'tool_calls',
                calls: [{ id: 't-1', name: 'tool-x', status: 'success' }]
            },
            { type: 'text', text: ' End' }
        ];

        const serialized = serializeAgentParts(original);
        const deserialized = deserializeAgentParts(serialized);

        expect(deserialized).toEqual(original);
    });

    it('guarantees roundtrip with characters requiring escaping', () => {
        const original: AgentPart[] = [
            { type: 'text', text: 'This has & and <| or even &lt;| ' },
            { type: 'thought', text: 'Thoughts with <|thought|> tags inside' },
            { type: 'text', text: ' & another text & ' }
        ];

        const serialized = serializeAgentParts(original);
        expect(serialized).toBe(
            'This has &amp; and &lt;| or even &amp;lt;| <|thought|>Thoughts with &lt;|thought|> tags inside<|/thought|> &amp; another text &amp; '
        );

        const deserialized = deserializeAgentParts(serialized);
        expect(deserialized).toEqual(original);
    });
});

describe('AgentPart presentation', () => {
    it('shows the last content, its preceding inlay, and following parts', () => {
        const parts: AgentPart[] = [
            { type: 'text', text: 'I will inspect that.' },
            {
                type: 'tool_calls',
                calls: [{ id: 'tool-1', name: 'inspect', status: 'success' }]
            },
            { type: 'thought', text: 'Composing the answer' },
            { type: 'text', text: 'Here it is:' },
            { type: 'inlay', ids: ['image-1'] },
            { type: 'text', text: 'The final caption.' }
        ];

        expect(findVisibleStartIndex(parts)).toBe(4);
        expect(getVisibleParts(parts)).toEqual([
            { type: 'inlay', ids: ['image-1'] },
            { type: 'text', text: 'The final caption.' }
        ]);
        expect(getLastTextPart(parts)).toEqual({
            type: 'text',
            text: 'The final caption.'
        });
    });

    it('keeps an inlay-only response visible', () => {
        const parts: AgentPart[] = [{ type: 'inlay', ids: ['image-1'] }];
        expect(findVisibleStartIndex(parts)).toBe(0);
        expect(hasVisibleAgentOutput(parts)).toBe(true);
    });

    it('keeps inlays after the last content visible', () => {
        const parts: AgentPart[] = [
            { type: 'text', text: 'Earlier step' },
            { type: 'text', text: 'Final answer' },
            { type: 'inlay', ids: ['image-1'] }
        ];

        expect(getVisibleParts(parts)).toEqual([
            { type: 'text', text: 'Final answer' },
            { type: 'inlay', ids: ['image-1'] }
        ]);
    });
});

describe('getWorkflowLLMTypes', () => {
    it('collects Agent types from a workflow', () => {
        const definitions = getWorkflowLLMTypes(createDefaultTranslationWorkflow());

        expect(definitions).toEqual([
            {
                type: 'translation',
                description: 'Model used by Translator'
            }
        ]);
    });

    it('collects Agent types present in a chat workflow', () => {
        const definitions = getWorkflowLLMTypes(createDefaultChatWorkflow());

        expect(definitions).toEqual([
            {
                type: 'chat',
                description: 'Model used by Chat Agent'
            }
        ]);
    });

    it('returns empty array if workflow is undefined', () => {
        const definitions = getWorkflowLLMTypes(undefined);

        expect(definitions).toEqual([]);
    });
});

describe('agentPartsToLLMMessages', () => {
    it('groups requests and responses from the same tool batch', async () => {
        mockGetToolCall.mockImplementation(async (id: string) => ({
            id,
            chatId: 'chat-1',
            status: 'success',
            call: {
                callId: `provider-${id}`,
                name: 'file_read',
                args: { path: `${id}.txt` }
            },
            response: [{ type: 'text', text: `result-${id}` }]
        }));

        await expect(
            agentPartsToLLMMessages(
                [
                    { type: 'thought', text: 'I should inspect the file.' },
                    { type: 'text', text: 'Reading.' },
                    {
                        type: 'tool_calls',
                        calls: [
                            { id: 'tool-1', name: 'file_read', status: 'success' },
                            { id: 'tool-2', name: 'file_read', status: 'success' }
                        ]
                    }
                ],
                'assistant',
                chat
            )
        ).resolves.toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'thought', text: 'I should inspect the file.' },
                    { type: 'text', text: 'Reading.' },
                    {
                        type: 'tool_request',
                        callId: 'provider-tool-1',
                        name: 'file_read',
                        args: { path: 'tool-1.txt' }
                    },
                    {
                        type: 'tool_request',
                        callId: 'provider-tool-2',
                        name: 'file_read',
                        args: { path: 'tool-2.txt' }
                    }
                ]
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_response',
                        callId: 'provider-tool-1',
                        name: 'file_read',
                        content: [{ type: 'text', text: 'result-tool-1' }]
                    },
                    {
                        type: 'tool_response',
                        callId: 'provider-tool-2',
                        name: 'file_read',
                        content: [{ type: 'text', text: 'result-tool-2' }]
                    }
                ]
            }
        ]);
    });

    it('uses a compact text fallback when details are unavailable', async () => {
        mockGetToolCall.mockResolvedValue(null);
        await expect(
            agentPartsToLLMMessages(
                [
                    {
                        type: 'tool_calls',
                        calls: [{ id: 'missing', name: 'file_read', status: 'error' }]
                    }
                ],
                'assistant',
                chat
            )
        ).resolves.toEqual([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: '[Tool call: file_read — error; details unavailable]'
                    }
                ]
            }
        ]);
    });
});
