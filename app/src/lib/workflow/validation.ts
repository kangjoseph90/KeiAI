import { AppError } from '$lib/types/errors';
import {
    WORKFLOW_NODE_DEFINITIONS,
    canConnectWorkflowPortTypes,
    getWorkflowInputPortDefinition,
    getWorkflowOutputPortDefinition
} from './registry';
import type { WorkflowDefinition } from './types';

type VisitState = 'visiting' | 'visited';

export function validateWorkflow(workflow: WorkflowDefinition): void {
    validateAgentSlots(workflow);
    validateInputValues(workflow);
    validateConnectionTypes(workflow);
    validateNoCycles(workflow);
}

export function validateWorkflowConnection(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    targetInputId: string,
    sourceNodeId: string,
    sourcePort = 0
): void {
    const target = workflow.nodes[targetNodeId];
    if (!target) throw new AppError('NOT_FOUND', `Workflow node not found: ${targetNodeId}`);

    const source = workflow.nodes[sourceNodeId];
    if (!source) throw new AppError('NOT_FOUND', `Workflow node not found: ${sourceNodeId}`);

    const input = getWorkflowInputPortDefinition(target, targetInputId);
    if (!(targetInputId in target.inputs) || !input) {
        throw new AppError(
            'NOT_FOUND',
            `Workflow input not found: ${targetNodeId}.${targetInputId}`
        );
    }
    if (!Number.isInteger(sourcePort) || sourcePort < 0) {
        throw new AppError('INVALID_INPUT', `Invalid workflow source port: ${sourcePort}`);
    }

    const output = getWorkflowOutputPortDefinition(source, sourcePort);
    if (!output) {
        throw new AppError(
            'NOT_FOUND',
            `Workflow output port not found: ${sourceNodeId}.${sourcePort}`
        );
    }
    if (!canConnectWorkflowPortTypes(output.type, input.type)) {
        throw new AppError(
            'INVALID_INPUT',
            `Workflow port type mismatch: ${sourceNodeId}.${sourcePort} (${output.type}) -> ${targetNodeId}.${targetInputId} (${input.type})`
        );
    }

    if (wouldCreateCycle(workflow, targetNodeId, sourceNodeId)) {
        throw new AppError(
            'INVALID_INPUT',
            `Workflow connection would create a cycle: ${sourceNodeId} -> ${targetNodeId}`
        );
    }
}

export function canConnectWorkflowNodes(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    targetInputId: string,
    sourceNodeId: string,
    sourcePort = 0
): boolean {
    return (
        getWorkflowConnectionError(
            workflow,
            targetNodeId,
            targetInputId,
            sourceNodeId,
            sourcePort
        ) === null
    );
}

export function getWorkflowConnectionError(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    targetInputId: string,
    sourceNodeId: string,
    sourcePort = 0
): string | null {
    try {
        validateWorkflowConnection(workflow, targetNodeId, targetInputId, sourceNodeId, sourcePort);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid workflow connection';
    }
}

function validateNoCycles(workflow: WorkflowDefinition): void {
    const states = new Map<string, VisitState>();
    const path: string[] = [];

    const visit = (nodeId: string): void => {
        const state = states.get(nodeId);
        if (state === 'visited') return;

        if (state === 'visiting') {
            const cycleStart = path.indexOf(nodeId);
            const cycle = [...path.slice(cycleStart), nodeId].join(' -> ');
            throw new AppError('INVALID_INPUT', `Workflow graph has a cycle: ${cycle}`);
        }

        const node = workflow.nodes[nodeId];
        if (!node) {
            throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
        }

        states.set(nodeId, 'visiting');
        path.push(nodeId);

        for (const connection of Object.values(node.inputs)) {
            if (connection) {
                const source = workflow.nodes[connection.sourceNode];
                const output = source
                    ? getWorkflowOutputPortDefinition(source, connection.sourcePort)
                    : undefined;
                if (source && !output) {
                    throw new AppError(
                        'NOT_FOUND',
                        `Workflow output port not found: ${connection.sourceNode}.${connection.sourcePort}`
                    );
                }
                visit(connection.sourceNode);
            }
        }

        path.pop();
        states.set(nodeId, 'visited');
    };

    for (const nodeId of Object.keys(workflow.nodes)) {
        visit(nodeId);
    }
}

function wouldCreateCycle(
    workflow: WorkflowDefinition,
    targetNodeId: string,
    sourceNodeId: string
): boolean {
    if (targetNodeId === sourceNodeId) return true;

    const visited = new Set<string>();
    const stack = [sourceNodeId];
    while (stack.length > 0) {
        const nodeId = stack.pop();
        if (!nodeId || visited.has(nodeId)) continue;
        if (nodeId === targetNodeId) return true;
        visited.add(nodeId);

        const node = workflow.nodes[nodeId];
        if (!node) continue;
        for (const connection of Object.values(node.inputs)) {
            if (connection) stack.push(connection.sourceNode);
        }
    }
    return false;
}

function validateAgentSlots(workflow: WorkflowDefinition): void {
    for (const node of Object.values(workflow.nodes)) {
        if (node.class !== 'Agent') continue;

        const staticInputs = new Set(Object.keys(WORKFLOW_NODE_DEFINITIONS.Agent.inputs));
        const inputIds = Object.keys(node.inputs).filter((inputId) => !staticInputs.has(inputId));
        const slotIds = Object.keys(node.slotNames);
        if (
            inputIds.length !== slotIds.length ||
            inputIds.some((inputId) => !(inputId in node.slotNames))
        ) {
            throw new AppError(
                'INVALID_INPUT',
                `Agent inputs and slot names do not match: ${node.id}`
            );
        }

        const names = new Set<string>();
        for (const inputId of inputIds) {
            const name = node.slotNames[inputId];
            if (!name || name !== name.trim()) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Agent input slot name is invalid: ${node.id}.${inputId}`
                );
            }
            if (names.has(name)) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Agent input slot name is duplicated: ${node.id}.${name}`
                );
            }
            names.add(name);
        }
    }
}

function validateInputValues(workflow: WorkflowDefinition): void {
    for (const node of Object.values(workflow.nodes)) {
        for (const inputId of Object.keys(node.inputs)) {
            const input = getWorkflowInputPortDefinition(node, inputId);
            if (!input) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Workflow input has no matching definition: ${node.id}.${inputId}`
                );
            }
        }

        for (const inputId of Object.keys(node.inputValues)) {
            if (!(inputId in node.inputs) && getWorkflowInputPortDefinition(node, inputId)) {
                continue;
            }
            if (!(inputId in node.inputs)) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Workflow input value has no matching input: ${node.id}.${inputId}`
                );
            }
        }

        if (
            node.class === 'Agent' &&
            Object.keys(node.inputs).some(
                (inputId) => inputId in node.slotNames && !(inputId in node.inputValues)
            )
        ) {
            throw new AppError(
                'INVALID_INPUT',
                `Agent inputs and input values do not match: ${node.id}`
            );
        }
    }
}

function validateConnectionTypes(workflow: WorkflowDefinition): void {
    for (const node of Object.values(workflow.nodes)) {
        for (const [inputId, connection] of Object.entries(node.inputs)) {
            if (!connection) continue;
            const source = workflow.nodes[connection.sourceNode];
            const input = getWorkflowInputPortDefinition(node, inputId);
            const output = source
                ? getWorkflowOutputPortDefinition(source, connection.sourcePort)
                : undefined;

            if (!source || !input || !output) continue;
            if (canConnectWorkflowPortTypes(output.type, input.type)) continue;

            throw new AppError(
                'INVALID_INPUT',
                `Workflow port type mismatch: ${connection.sourceNode}.${connection.sourcePort} (${output.type}) -> ${node.id}.${inputId} (${input.type})`
            );
        }
    }
}
