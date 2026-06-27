import { AppError } from '$lib/types/errors';
import { WORKFLOW_NODE_DEFINITIONS } from './registry';
import type { WorkflowDefinition } from './types';

type VisitState = 'visiting' | 'visited';

export function validateWorkflow(workflow: WorkflowDefinition): void {
    validateSingleOutput(workflow);
    validateAgentSlots(workflow);
    validateInputValues(workflow);

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
                if (
                    source &&
                    !(connection.sourcePort in WORKFLOW_NODE_DEFINITIONS[source.class].outputs)
                ) {
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

function validateAgentSlots(workflow: WorkflowDefinition): void {
    for (const node of Object.values(workflow.nodes)) {
        if (node.class !== 'Agent') continue;

        const inputIds = Object.keys(node.inputs);
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
        for (const inputId of Object.keys(node.inputValues)) {
            if (!(inputId in node.inputs)) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Workflow input value has no matching input: ${node.id}.${inputId}`
                );
            }
        }

        if (
            node.class === 'Agent' &&
            Object.keys(node.inputs).some((inputId) => !(inputId in node.inputValues))
        ) {
            throw new AppError(
                'INVALID_INPUT',
                `Agent inputs and input values do not match: ${node.id}`
            );
        }
    }
}

function validateSingleOutput(workflow: WorkflowDefinition): void {
    const count = Object.values(workflow.nodes).filter((node) => node.class === 'Output').length;
    if (count !== 1) {
        throw new AppError(
            'INVALID_INPUT',
            `Workflow must have exactly one Output node, found ${count}`
        );
    }
}

export function getWorkflowOutputNodeId(workflow: WorkflowDefinition): string {
    const output = Object.values(workflow.nodes).find((node) => node.class === 'Output');
    if (!output) {
        throw new AppError('INVALID_INPUT', 'Workflow must have exactly one Output node, found 0');
    }
    return output.id;
}
