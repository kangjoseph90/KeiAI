import type { WorkflowNodeStreamState, WorkflowPortType, WorkflowValue } from './types';

export function workflowValueToString(value: WorkflowValue): string {
    return String(value);
}

export function createWorkflowStreamState(
    value: WorkflowValue,
    type: WorkflowPortType = inferWorkflowValueType(value)
): WorkflowNodeStreamState {
    return {
        value,
        type,
        content: workflowValueToString(value)
    };
}

export function inferWorkflowValueType(value: WorkflowValue): WorkflowPortType {
    switch (typeof value) {
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'string':
            return 'string';
    }
}

export function coerceWorkflowValue(
    value: WorkflowValue,
    targetType: WorkflowPortType
): WorkflowValue {
    const sourceType = inferWorkflowValueType(value);
    if (sourceType === targetType) return value;
    if (targetType === 'string') return workflowValueToString(value);
    throw new Error(`Cannot coerce ${sourceType} to ${targetType}`);
}
