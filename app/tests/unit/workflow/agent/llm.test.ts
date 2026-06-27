import { describe, expect, it } from 'vitest';
import { getWorkflowLLMTypes } from '$lib/workflow/agent/llm';
import { createDefaultChatWorkflow, createDefaultTranslationWorkflow } from '$lib/workflow';

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
