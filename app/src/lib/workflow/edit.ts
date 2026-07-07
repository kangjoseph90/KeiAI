import { AppError } from '$lib/types/errors';
import type { DeepPartial } from '$lib/utils/defaults';
import { deepMerge, createPatch, NO_CHANGE } from '$lib/utils/defaults';
import { generateId } from '$lib/utils/id';
import { createDefaultWorkflowNode } from './registry';
import { validateWorkflowConnection } from './validation';
import type {
    AgentNode,
    PromptBlock,
    PromptBlockFields,
    WorkflowDefinition,
    WorkflowNode,
    WorkflowNodeClass,
    WorkflowNodePosition,
    WorkflowPatch
} from './types';

type EditableNode<TNode> = TNode extends WorkflowNode
    ? Omit<DeepPartial<TNode>, 'id' | 'class' | 'inputs' | 'slotNames'>
    : never;

export type WorkflowNodeChanges = EditableNode<WorkflowNode>;

export type CreatePromptBlockFields = PromptBlockFields & {
    sortOrder: string;
    enabled?: boolean;
};

export interface WorkflowEditResult {
    workflow: WorkflowDefinition;
    patch: WorkflowPatch;
}

export interface CreateWorkflowNodeResult extends WorkflowEditResult {
    nodeId: string;
}

export interface CreatePromptBlockResult extends WorkflowEditResult {
    blockId: string;
}

export interface CreateAgentInputResult extends WorkflowEditResult {
    inputId: string;
}

export function createNode(
    workflow: WorkflowDefinition,
    nodeClass: WorkflowNodeClass,
    position: WorkflowNodePosition = { x: 0, y: 0 }
): CreateWorkflowNodeResult {
    const next = structuredClone(workflow);
    const nodeId = createUnusedId(next.nodes);
    const node = createDefaultWorkflowNode(nodeClass, nodeId);

    next.nodes[nodeId] = {
        ...node,
        position: { ...position },
        id: nodeId
    };

    return { ...createEditResult(workflow, next), nodeId };
}

export function updateNode(
    workflow: WorkflowDefinition,
    nodeId: string,
    changes: WorkflowNodeChanges
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const node = requireNode(next, nodeId);

    if ('id' in changes || 'class' in changes || 'inputs' in changes || 'slotNames' in changes) {
        throw new AppError(
            'INVALID_INPUT',
            'Workflow node identity and inputs cannot be changed with updateNode'
        );
    }

    const updated = deepMerge(node, changes) as WorkflowNode;
    next.nodes[nodeId] = {
        ...updated,
        id: node.id,
        class: node.class
    } as WorkflowNode;

    return createEditResult(workflow, next);
}

export function deleteNode(workflow: WorkflowDefinition, nodeId: string): WorkflowEditResult {
    const next = structuredClone(workflow);
    requireNode(next, nodeId);
    delete next.nodes[nodeId];

    for (const node of Object.values(next.nodes)) {
        for (const [inputName, input] of Object.entries(node.inputs)) {
            if (input?.sourceNode === nodeId) {
                node.inputs[inputName] = null;
            }
        }
    }

    return createEditResult(workflow, next);
}

export function connectNodes(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    targetInput: string,
    sourceNodeId: string,
    sourcePort = 0
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const target = requireNode(next, targetNodeId);
    requireNode(next, sourceNodeId);
    validateWorkflowConnection(next, targetNodeId, targetInput, sourceNodeId, sourcePort);

    target.inputs[targetInput] = { sourceNode: sourceNodeId, sourcePort };

    return createEditResult(workflow, next);
}

export function createAgentInput(
    workflow: WorkflowDefinition,
    nodeId: string,
    slotName: string
): CreateAgentInputResult {
    const next = structuredClone(workflow);
    const node = requireAgentNode(next, nodeId);
    const normalizedName = requireUniqueSlotName(node, slotName);
    const inputId = createUnusedId(node.inputs);

    node.inputs[inputId] = null;
    node.slotNames[inputId] = normalizedName;
    node.inputValues[inputId] = '';

    return { ...createEditResult(workflow, next), inputId };
}

export function renameAgentInput(
    workflow: WorkflowDefinition,
    nodeId: string,
    inputId: string,
    slotName: string
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const node = requireAgentInput(next, nodeId, inputId);
    node.slotNames[inputId] = requireUniqueSlotName(node, slotName, inputId);
    return createEditResult(workflow, next);
}

export function deleteAgentInput(
    workflow: WorkflowDefinition,
    nodeId: string,
    inputId: string
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const node = requireAgentInput(next, nodeId, inputId);
    delete node.inputs[inputId];
    delete node.slotNames[inputId];
    delete node.inputValues[inputId];
    return createEditResult(workflow, next);
}

export function disconnectNodeInput(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    targetInput: string
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const target = requireNode(next, targetNodeId);

    if (!(targetInput in target.inputs)) {
        throw new AppError('NOT_FOUND', `Workflow input not found: ${targetNodeId}.${targetInput}`);
    }

    target.inputs[targetInput] = null;
    return createEditResult(workflow, next);
}

export function createBlock(
    workflow: WorkflowDefinition,
    nodeId: string,
    fields: CreatePromptBlockFields
): CreatePromptBlockResult {
    const next = structuredClone(workflow);
    const node = requireAgentNode(next, nodeId);
    const blockId = createUnusedId(node.promptBlocks);

    node.promptBlocks[blockId] = normalizePromptBlock({
        ...fields,
        enabled: fields.enabled ?? true,
        id: blockId
    } as PromptBlock);

    return { ...createEditResult(workflow, next), blockId };
}

export function updateBlock(
    workflow: WorkflowDefinition,
    nodeId: string,
    blockId: string,
    changes: DeepPartial<PromptBlock>
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const node = requireAgentNode(next, nodeId);
    const block = node.promptBlocks[blockId];
    if (!block) throw new AppError('NOT_FOUND', `Prompt block not found: ${blockId}`);
    if ('id' in changes) {
        throw new AppError('INVALID_INPUT', 'Prompt block id cannot be changed');
    }

    const updated = deepMerge(block, changes) as PromptBlock;
    node.promptBlocks[blockId] = normalizePromptBlock({ ...updated, id: block.id });

    return createEditResult(workflow, next);
}

export function deleteBlock(
    workflow: WorkflowDefinition,
    nodeId: string,
    blockId: string
): WorkflowEditResult {
    const next = structuredClone(workflow);
    const node = requireAgentNode(next, nodeId);
    if (!node.promptBlocks[blockId]) {
        throw new AppError('NOT_FOUND', `Prompt block not found: ${blockId}`);
    }

    delete node.promptBlocks[blockId];
    return createEditResult(workflow, next);
}

function createEditResult(
    workflow: WorkflowDefinition,
    next: WorkflowDefinition
): WorkflowEditResult {
    const patch = createPatch(workflow, next);
    return {
        workflow: next,
        patch: patch === NO_CHANGE ? {} : (patch as WorkflowPatch)
    };
}

function requireNode(workflow: WorkflowDefinition, nodeId: string): WorkflowNode {
    const node = workflow.nodes[nodeId];
    if (!node) throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
    return node;
}

function requireAgentNode(workflow: WorkflowDefinition, nodeId: string): AgentNode {
    const node = requireNode(workflow, nodeId);
    if (node.class !== 'Agent') {
        throw new AppError('INVALID_INPUT', `Workflow node is not an Agent: ${nodeId}`);
    }
    return node;
}

function requireAgentInput(
    workflow: WorkflowDefinition,
    nodeId: string,
    inputId: string
): AgentNode {
    const node = requireAgentNode(workflow, nodeId);
    if (!(inputId in node.inputs) || !(inputId in node.slotNames)) {
        throw new AppError('NOT_FOUND', `Agent input not found: ${nodeId}.${inputId}`);
    }
    return node;
}

function requireUniqueSlotName(node: AgentNode, slotName: string, inputId?: string): string {
    const normalizedName = slotName.trim();
    if (!normalizedName) {
        throw new AppError('INVALID_INPUT', 'Agent input slot name cannot be empty');
    }

    for (const [existingInputId, existingName] of Object.entries(node.slotNames)) {
        if (existingInputId !== inputId && existingName === normalizedName) {
            throw new AppError(
                'INVALID_INPUT',
                `Agent input slot name is duplicated: ${normalizedName}`
            );
        }
    }
    return normalizedName;
}

function createUnusedId(records: Readonly<Record<string, unknown>>): string {
    let id = generateId();
    while (records[id]) id = generateId();
    return id;
}

function normalizePromptBlock(block: PromptBlock): PromptBlock {
    const common = {
        name: block.name,
        sortOrder: block.sortOrder,
        enabled: block.enabled,
        id: block.id
    };

    switch (block.type) {
        case 'text':
            return {
                ...common,
                type: 'text',
                role: block.role ?? 'system',
                content: block.content ?? ''
            };
        case 'history':
            return {
                ...common,
                type: 'history',
                ...(block.start === undefined ? {} : { start: block.start }),
                ...(block.end === undefined ? {} : { end: block.end }),
                ...(block.format === undefined ? {} : { format: block.format })
            };
        case 'lorebook':
            return {
                ...common,
                type: 'lorebook',
                ...(block.minDepth === undefined ? {} : { minDepth: block.minDepth }),
                ...(block.maxDepth === undefined ? {} : { maxDepth: block.maxDepth }),
                ...(block.reverseOrder === undefined ? {} : { reverseOrder: block.reverseOrder }),
                ...(block.format === undefined ? {} : { format: block.format })
            };
    }
}
