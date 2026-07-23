import { describe, expect, it } from 'vitest';
import { deepMerge } from '$lib/utils/defaults';
import {
    connectNodes,
    createAgentInput,
    createBlock,
    createDefaultChatWorkflow,
    createNode,
    deleteAgentInput,
    deleteBlock,
    deleteNode,
    disconnectNodeInput,
    renameAgentInput,
    updateBlock,
    updateNode,
    type WorkflowDefinition,
    type WorkflowEditResult
} from '$lib/workflow';

describe('workflow edits', () => {
    it('creates a default node at the requested position', () => {
        const workflow = createDefaultChatWorkflow();
        const result = createNode(workflow, 'String', { x: 120, y: 240 });

        expect(result.workflow.nodes[result.nodeId]).toMatchObject({
            id: result.nodeId,
            class: 'String',
            position: { x: 120, y: 240 }
        });
        expect(result.patch.nodes?.[result.nodeId]).toEqual(result.workflow.nodes[result.nodeId]);
        expectPatchApplies(workflow, result);
        expect(workflow.nodes[result.nodeId]).toBeUndefined();
    });

    it('updates a node without allowing its identity to change', () => {
        const workflow = createDefaultChatWorkflow();
        const result = updateNode(workflow, 'chat_agent', {
            name: 'Translator',
            position: { x: 20, y: 40 },
            maxContext: 12000
        });

        expect(result.workflow.nodes.chat_agent).toMatchObject({
            id: 'chat_agent',
            class: 'Agent',
            name: 'Translator',
            position: { x: 20, y: 40 },
            maxContext: 12000
        });
        expectPatchApplies(workflow, result);
    });

    it('deletes a node and disconnects every input that references it', () => {
        const workflow = createDefaultChatWorkflow();
        const result = deleteNode(workflow, 'chat_agent');

        expect(result.workflow.nodes.chat_agent).toBeUndefined();
        expect(result.workflow.nodes.output.inputs.content).toBeNull();
        expect(result.patch).toEqual({
            nodes: {
                chat_agent: undefined,
                output: { inputs: { content: null } }
            }
        });
        expectPatchApplies(workflow, result);
    });

    it('connects and disconnects existing node inputs', () => {
        const workflow = createDefaultChatWorkflow();
        const created = createNode(workflow, 'String');
        const connected = connectNodes(created.workflow, 'output', 'content', created.nodeId);
        const disconnected = disconnectNodeInput(connected.workflow, 'output', 'content');

        expect(connected.workflow.nodes.output.inputs.content).toEqual({
            sourceNode: created.nodeId,
            sourcePort: 0
        });
        expectPatchApplies(created.workflow, connected);
        expect(disconnected.workflow.nodes.output.inputs.content).toBeNull();
        expectPatchApplies(connected.workflow, disconnected);
    });

    it('does not allow the terminal Output node to be used as a source', () => {
        const workflow = createDefaultChatWorkflow();
        const concat = createNode(workflow, 'Concat');

        expect(() => connectNodes(concat.workflow, concat.nodeId, 'a', 'output')).toThrow(
            'Workflow output port not found: output.0'
        );
    });

    it('rejects connections with incompatible port types', () => {
        const workflow = createDefaultChatWorkflow();
        const source = createNode(workflow, 'String');
        const math = createNode(source.workflow, 'NumberMath');

        expect(() => connectNodes(math.workflow, math.nodeId, 'a', source.nodeId)).toThrow(
            `Workflow port type mismatch: ${source.nodeId}.0 (string) -> ${math.nodeId}.a (number)`
        );
    });

    it('rejects connections that would create a cycle', () => {
        const workflow = createDefaultChatWorkflow();
        const left = createNode(workflow, 'Concat');
        const right = createNode(left.workflow, 'Concat');
        const connected = connectNodes(right.workflow, right.nodeId, 'a', left.nodeId);

        expect(() => connectNodes(connected.workflow, left.nodeId, 'a', right.nodeId)).toThrow(
            `Workflow connection would create a cycle: ${right.nodeId} -> ${left.nodeId}`
        );
    });

    it('keeps named Agent inputs when their connections are removed', () => {
        const workflow = createDefaultChatWorkflow();
        const source = createNode(workflow, 'String');
        const created = createAgentInput(source.workflow, 'chat_agent', '  sourceText  ');
        const connected = connectNodes(
            created.workflow,
            'chat_agent',
            created.inputId,
            source.nodeId
        );
        const disconnected = disconnectNodeInput(connected.workflow, 'chat_agent', created.inputId);

        const disconnectedAgent = disconnected.workflow.nodes.chat_agent;
        expect(disconnectedAgent.class).toBe('Agent');
        if (disconnectedAgent.class !== 'Agent') throw new Error('Expected Agent node');
        expect(disconnectedAgent.inputs[created.inputId]).toBeNull();
        expect(disconnectedAgent.slotNames[created.inputId]).toBe('sourceText');
        expect(disconnectedAgent.inputValues[created.inputId]).toBe('');
        expectPatchApplies(source.workflow, created);
        expectPatchApplies(created.workflow, connected);
        expectPatchApplies(connected.workflow, disconnected);

        const renamed = renameAgentInput(
            disconnected.workflow,
            'chat_agent',
            created.inputId,
            'content'
        );
        const renamedAgent = renamed.workflow.nodes.chat_agent;
        expect(renamedAgent.class).toBe('Agent');
        if (renamedAgent.class !== 'Agent') throw new Error('Expected Agent node');
        expect(renamedAgent.slotNames[created.inputId]).toBe('content');
        expectPatchApplies(disconnected.workflow, renamed);

        const deleted = deleteAgentInput(renamed.workflow, 'chat_agent', created.inputId);
        const deletedAgent = deleted.workflow.nodes.chat_agent;
        expect(deletedAgent.class).toBe('Agent');
        if (deletedAgent.class !== 'Agent') throw new Error('Expected Agent node');
        expect(created.inputId in deletedAgent.inputs).toBe(false);
        expect(created.inputId in deletedAgent.slotNames).toBe(false);
        expect(created.inputId in deletedAgent.inputValues).toBe(false);
        expectPatchApplies(renamed.workflow, deleted);
    });

    it('rejects duplicate Agent slot names', () => {
        const workflow = createDefaultChatWorkflow();
        const created = createAgentInput(workflow, 'chat_agent', 'source');

        expect(() => createAgentInput(created.workflow, 'chat_agent', 'source')).toThrow(
            'Agent input slot name is duplicated: source'
        );
    });

    it('creates, updates, and deletes a block on the selected Agent node', () => {
        const workflow = createDefaultChatWorkflow();
        const created = createBlock(workflow, 'chat_agent', {
            name: 'Instruction',
            type: 'text',
            role: 'system',
            content: 'Translate this.',
            sortOrder: 'a0'
        });

        expect(created.workflow.nodes.chat_agent).toMatchObject({
            class: 'Agent',
            promptBlocks: {
                [created.blockId]: {
                    id: created.blockId,
                    enabled: true,
                    type: 'text',
                    content: 'Translate this.'
                }
            }
        });
        expectPatchApplies(workflow, created);

        const updated = updateBlock(created.workflow, 'chat_agent', created.blockId, {
            type: 'history',
            historyMode: 'last_content',
            start: -5,
            format: '{{slot}}'
        });
        const updatedAgent = updated.workflow.nodes.chat_agent;
        expect(updatedAgent.class).toBe('Agent');
        if (updatedAgent.class !== 'Agent') throw new Error('Expected Agent node');
        expect(updatedAgent.promptBlocks[created.blockId]).toEqual({
            id: created.blockId,
            name: 'Instruction',
            type: 'history',
            historyMode: 'last_content',
            start: -5,
            format: '{{slot}}',
            sortOrder: 'a0',
            enabled: true
        });
        expect(updated.patch).toMatchObject({
            nodes: {
                chat_agent: {
                    promptBlocks: {
                        [created.blockId]: {
                            type: 'history',
                            role: undefined,
                            content: undefined
                        }
                    }
                }
            }
        });
        expectPatchApplies(created.workflow, updated);

        const deleted = deleteBlock(updated.workflow, 'chat_agent', created.blockId);
        expect(deleted.patch).toEqual({
            nodes: {
                chat_agent: {
                    promptBlocks: {
                        [created.blockId]: undefined
                    },
                    toolIds: []
                }
            }
        });
        expectPatchApplies(updated.workflow, deleted);
    });

    it('rejects block edits for a non-Agent node', () => {
        const workflow = createDefaultChatWorkflow();

        expect(() =>
            createBlock(workflow, 'output', {
                name: 'Invalid',
                type: 'text',
                role: 'system',
                content: '',
                sortOrder: 'a0'
            })
        ).toThrow('Workflow node is not an Agent: output');
    });
});

function expectPatchApplies(before: WorkflowDefinition, result: WorkflowEditResult): void {
    expect(deepMerge(before, result.patch)).toEqual(result.workflow);
}
