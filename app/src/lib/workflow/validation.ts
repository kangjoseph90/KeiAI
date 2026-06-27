import { AppError } from '$lib/types/errors';
import type { WorkflowDefinition } from './types';

type VisitState = 'visiting' | 'visited';

export function validateWorkflow(workflow: WorkflowDefinition): void {
    validateSingleOutput(workflow);

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
