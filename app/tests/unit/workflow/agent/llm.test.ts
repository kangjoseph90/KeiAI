import { describe, expect, it, vi } from 'vitest';
import {
    getWorkflowLLMTypes,
    serializeAgentParts,
    deserializeAgentParts,
    agentPartsToLLMMessages,
    type AgentPart
} from '$lib/workflow/agent/llm';
import { createDefaultChatWorkflow, createDefaultTranslationWorkflow } from '$lib/workflow';

const { mockGetToolCall } = vi.hoisted(() => ({ mockGetToolCall: vi.fn() }));

vi.mock('$lib/services/content/tool', () => ({
    ToolCallService: { get: mockGetToolCall }
}));

describe('serializeAgentParts', () => {
    it('serializes thought, content, and tool_call parts correctly with leading/trailing spaces preserved', () => {
        const parts: AgentPart[] = [
            { type: 'thought', text: '  thinking...  ' },
            { type: 'content', text: '\nHello World!\n' },
            { type: 'tool_call', id: 'call_1', name: 'search', status: 'pending' }
        ];
        const result = serializeAgentParts(parts);
        expect(result).toBe(
            '<|thought|>  thinking...  <|/thought|>\nHello World!\n<|tool_call id="call_1" name="search" status="pending"|>'
        );
    });

    it('returns empty string for empty parts array', () => {
        const result = serializeAgentParts([]);
        expect(result).toBe('');
    });
});

describe('deserializeAgentParts', () => {
    it('deserializes thought, content, and tool_call parts correctly', () => {
        const serialized =
            '<|thought|>  thinking...  <|/thought|>\nHello World!\n<|tool_call id="call_1" name="search" status="running"|>';
        const result = deserializeAgentParts(serialized);
        expect(result).toEqual([
            { type: 'thought', text: '  thinking...  ' },
            { type: 'content', text: '\nHello World!\n' },
            { type: 'tool_call', id: 'call_1', name: 'search', status: 'running' }
        ]);
    });

    it('returns empty array for empty string', () => {
        const result = deserializeAgentParts('');
        expect(result).toEqual([]);
    });

    it('guarantees roundtrip serialization/deserialization', () => {
        const original: AgentPart[] = [
            { type: 'content', text: 'Start ' },
            { type: 'thought', text: 'inner thought' },
            { type: 'content', text: ' mid ' },
            { type: 'tool_call', id: 't-1', name: 'tool-x', status: 'success' },
            { type: 'content', text: ' End' }
        ];

        const serialized = serializeAgentParts(original);
        const deserialized = deserializeAgentParts(serialized);

        expect(deserialized).toEqual(original);
    });

    it('guarantees roundtrip with characters requiring escaping', () => {
        const original: AgentPart[] = [
            { type: 'content', text: 'This has & and <| or even &lt;| ' },
            { type: 'thought', text: 'Thoughts with <|thought|> tags inside' },
            { type: 'content', text: ' & another text & ' }
        ];

        const serialized = serializeAgentParts(original);
        expect(serialized).toBe(
            'This has &amp; and &lt;| or even &amp;lt;| <|thought|>Thoughts with &lt;|thought|> tags inside<|/thought|> &amp; another text &amp; '
        );

        const deserialized = deserializeAgentParts(serialized);
        expect(deserialized).toEqual(original);
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
    it('loads structured tool request and response details', async () => {
        mockGetToolCall.mockResolvedValue({
            id: 'tool-1',
            chatId: 'chat-1',
            status: 'success',
            call: { callId: 'provider-1', name: 'file_read', args: { path: 'notes.txt' } },
            response: [{ type: 'text', text: 'hello' }]
        });

        await expect(
            agentPartsToLLMMessages([
                { type: 'content', text: 'Reading.' },
                { type: 'tool_call', id: 'tool-1', name: 'file_read', status: 'success' }
            ])
        ).resolves.toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Reading.' },
                    {
                        type: 'tool_request',
                        callId: 'provider-1',
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
                        callId: 'provider-1',
                        name: 'file_read',
                        content: [{ type: 'text', text: 'hello' }]
                    }
                ]
            }
        ]);
    });

    it('uses a compact text fallback when details are unavailable', async () => {
        mockGetToolCall.mockResolvedValue(null);
        await expect(
            agentPartsToLLMMessages([
                { type: 'tool_call', id: 'missing', name: 'file_read', status: 'error' }
            ])
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
