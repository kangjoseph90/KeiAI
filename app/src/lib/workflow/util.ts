import { AppError, getErrorMessage } from '$lib/types/errors';
import type {
    WorkflowInput,
    WorkflowNode,
    WorkflowNodeEvent,
    WorkflowPortType,
    WorkflowValue,
    WorkflowValueEvent
} from './types';

/** Throws an AbortError when the signal has already been aborted. */
export function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}

/** Awaits the input's terminal event, throwing if the input is missing. */
export function requireInput(
    input: WorkflowInput | undefined,
    message: string
): Promise<WorkflowNodeEvent> {
    if (!input) throw new AppError('INVALID_INPUT', message);
    return input.done;
}

export function workflowValueToString(value: WorkflowValue): string {
    return String(value);
}

export function createWorkflowValueEvent(value: WorkflowValue): WorkflowValueEvent {
    return {
        status: 'value',
        value
    };
}

export function createWorkflowSkipEvent(message?: string): WorkflowNodeEvent {
    return {
        status: 'skip',
        ...(message === undefined ? {} : { message })
    };
}

export function createWorkflowErrorEvent(node: WorkflowNode, error: unknown): WorkflowNodeEvent {
    const detail = getErrorMessage(error, 'Unknown workflow error');
    const message = `${node.name} failed: ${detail}`;
    return {
        status: 'error',
        error: isAbortError(error) ? error : new AppError('INVALID_INPUT', message, error),
        message,
        nodeId: node.id,
        nodeName: node.name
    };
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
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
