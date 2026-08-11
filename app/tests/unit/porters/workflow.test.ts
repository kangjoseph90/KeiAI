import { describe, expect, it } from 'vitest';
import {
    readAgentFile,
    readWorkflowFile,
    writeAgentFile,
    writeWorkflowFile
} from '$lib/porters/workflow';
import { createAgentInput, createDefaultChatWorkflow } from '$lib/workflow';

describe('workflow JSON files', () => {
    it('round-trips a workflow with its nodes and connections', async () => {
        const workflow = createDefaultChatWorkflow();
        const file = jsonFile(writeWorkflowFile(workflow), 'chat.workflow.json');

        await expect(readWorkflowFile(file)).resolves.toEqual(workflow);
    });

    it('round-trips portable Agent configuration without graph identity', async () => {
        const edited = createAgentInput(createDefaultChatWorkflow(), 'chat_agent', 'context');
        const agent = edited.workflow.nodes.chat_agent;
        expect(agent.class).toBe('Agent');
        if (agent.class !== 'Agent') throw new Error('Expected Agent node');
        agent.inputValues[edited.inputId] = 'fallback';

        const bytes = writeAgentFile(agent);
        const serialized = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        const file = jsonFile(bytes, 'chat-agent.agent.json');

        expect(serialized).toMatchObject({ version: 1, kind: 'keiai.agent' });
        expect(serialized.agent).not.toHaveProperty('id');
        expect(serialized.agent).not.toHaveProperty('position');
        expect(serialized.agent).not.toHaveProperty('inputs');
        await expect(readAgentFile(file)).resolves.toMatchObject({
            name: agent.name,
            slotNames: { [edited.inputId]: 'context' },
            inputValues: { stream: true, [edited.inputId]: 'fallback' }
        });
    });

    it('rejects JSON for a different package kind', async () => {
        const file = new File(
            [JSON.stringify({ version: 1, kind: 'keiai.agent', agent: {} })],
            'wrong.json',
            { type: 'application/json' }
        );

        await expect(readWorkflowFile(file)).rejects.toThrow('Invalid KeiAI workflow file');
    });
});

function jsonFile(bytes: Uint8Array, name: string): File {
    return new File([bytes.slice()], name, { type: 'application/json' });
}
