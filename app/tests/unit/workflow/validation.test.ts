import { describe, expect, it } from 'vitest';
import {
    createAgentInput,
    createDefaultChatWorkflow,
    createDefaultTranslationWorkflow,
    validateWorkflow
} from '$lib/workflow';

describe('default workflows', () => {
    it('creates a valid translation workflow with one Agent and one Output', () => {
        const workflow = createDefaultTranslationWorkflow();

        expect(() => validateWorkflow(workflow)).not.toThrow();
        expect(workflow.nodes.translation_agent).toMatchObject({
            class: 'Agent',
            llmType: 'translation'
        });
        expect(workflow.nodes.translation_output).toMatchObject({ class: 'Output' });
    });
});

describe('validateWorkflow Agent inputs', () => {
    it('accepts matching input ids with unique slot names', () => {
        const workflow = createDefaultChatWorkflow();
        const first = createAgentInput(workflow, 'chat_agent', 'source');
        const second = createAgentInput(first.workflow, 'chat_agent', 'targetLang');

        expect(() => validateWorkflow(second.workflow)).not.toThrow();
    });

    it('rejects input ids without matching slot names', () => {
        const workflow = createDefaultChatWorkflow();
        const agent = workflow.nodes.chat_agent;
        if (agent.class !== 'Agent') throw new Error('Expected Agent node');
        agent.inputs.orphan = null;

        expect(() => validateWorkflow(workflow)).toThrow(
            'Agent inputs and slot names do not match: chat_agent'
        );
    });

    it('rejects duplicate slot names', () => {
        const workflow = createDefaultChatWorkflow();
        const agent = workflow.nodes.chat_agent;
        if (agent.class !== 'Agent') throw new Error('Expected Agent node');
        agent.inputs.first = null;
        agent.inputs.second = null;
        agent.slotNames.first = 'source';
        agent.slotNames.second = 'source';

        expect(() => validateWorkflow(workflow)).toThrow(
            'Agent input slot name is duplicated: chat_agent.source'
        );
    });
});
