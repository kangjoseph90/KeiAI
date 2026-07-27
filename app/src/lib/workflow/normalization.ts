import { deepMerge } from '$lib/utils/defaults';
import {
    createDefaultWorkflowNode,
    getWorkflowInputPortDefinition,
    WORKFLOW_NODE_DEFINITIONS
} from './registry';
import type { AgentNode, PromptBlock, WorkflowDefinition, WorkflowNode } from './types';

export function normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    const nodes: Record<string, WorkflowNode> = {};

    for (const [id, node] of Object.entries(workflow.nodes)) {
        if (!WORKFLOW_NODE_DEFINITIONS[node.class]) continue;
        const defaults = createDefaultWorkflowNode(node.class, id);
        const merged = deepMerge(defaults, node);
        const normalized: WorkflowNode = {
            ...merged,
            id,
            class: node.class
        } as WorkflowNode;

        if (normalized.class === 'Agent') {
            normalized.promptBlocks = normalizePromptBlocks(normalized.promptBlocks);
        }
        for (const inputId of Object.keys(normalized.inputValues)) {
            if (getWorkflowInputPortDefinition(normalized, inputId)?.allowLiteral === false) {
                delete normalized.inputValues[inputId];
            }
        }
        nodes[id] = normalized;
    }

    return { nodes };
}

function normalizePromptBlock(block: PromptBlock, id: string = block.id): PromptBlock {
    const common = {
        id,
        name: '',
        sortOrder: '',
        enabled: true
    };

    switch (block.type) {
        case 'message': {
            const normalized = deepMerge(
                { ...common, type: 'message' as const, role: 'system' as const, content: '' },
                block
            );
            return { ...normalized, id, type: 'message' };
        }
        case 'history': {
            const normalized = deepMerge(
                { ...common, type: 'history' as const, historyMode: 'visible' as const },
                block
            );
            return { ...normalized, id, type: 'history' };
        }
        case 'lorebook': {
            const normalized = deepMerge({ ...common, type: 'lorebook' as const }, block);
            return { ...normalized, id, type: 'lorebook' };
        }
    }
}

function normalizePromptBlocks(blocks: AgentNode['promptBlocks']): AgentNode['promptBlocks'] {
    return Object.fromEntries(
        Object.entries(blocks).map(([id, block]) => [id, normalizePromptBlock(block, id)])
    );
}
