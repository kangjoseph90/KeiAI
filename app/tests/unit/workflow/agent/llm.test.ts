import { describe, expect, it } from 'vitest';
import {
    getWorkflowLLMTypes,
    serializeAgentParts,
    deserializeAgentParts,
    type AgentPart
} from '$lib/workflow/agent/llm';
import { createDefaultChatWorkflow, createDefaultTranslationWorkflow } from '$lib/workflow';

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
