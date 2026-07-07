import { AppError } from '$lib/types/errors';
import type {
    BooleanLogicNode,
    NumberCompareNode,
    NumberMathNode,
    WorkflowInput,
    WorkflowNode,
    WorkflowNodeEvent,
    WorkflowOutput,
    WorkflowValue
} from '../types';
import {
    createWorkflowErrorEvent,
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';

export async function requireNameAndContent(
    inputs: Record<string, WorkflowInput>,
    signal: AbortSignal
): Promise<{ name: string; content: string }> {
    const [name, content] = await Promise.all([
        requireStringInput(inputs.name, 'Variable name input is required', signal),
        requireStringInput(inputs.content, 'Variable content input is required', signal)
    ]);
    return { name, content };
}

export async function requireStringInput(
    input: WorkflowInput | undefined,
    message: string,
    signal: AbortSignal
): Promise<string> {
    const result = await requireInput(input, message);
    throwIfAborted(signal);
    if (result.status !== 'value') {
        throw new AppError('INVALID_INPUT', result.message ?? message);
    }
    return workflowValueToString(result.value);
}

export function requireWorkflowInput(
    input: WorkflowInput | undefined,
    message: string
): WorkflowInput {
    if (!input) throw new AppError('INVALID_INPUT', message);
    return input;
}

export function parseBoolean(value: string, nodeId: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    throw new AppError('INVALID_INPUT', `Cannot convert string to boolean: ${nodeId}`);
}

export function parseNumber(value: string, nodeId: string): number {
    const number = Number(value.trim());
    if (Number.isFinite(number)) return number;
    throw new AppError('INVALID_INPUT', `Cannot convert string to number: ${nodeId}`);
}

export function applyMath(
    operator: NumberMathNode['operator'],
    a: number,
    b: number,
    nodeId: string
): number {
    switch (operator) {
        case 'add':
            return a + b;
        case 'subtract':
            return a - b;
        case 'multiply':
            return a * b;
        case 'divide':
            if (b === 0) {
                throw new AppError('INVALID_INPUT', `Cannot divide by zero: ${nodeId}`);
            }
            return a / b;
    }
}

export function applyCompare(
    operator: NumberCompareNode['operator'],
    a: number,
    b: number
): boolean {
    switch (operator) {
        case 'equal':
            return a === b;
        case 'notEqual':
            return a !== b;
        case 'greaterThan':
            return a > b;
        case 'greaterThanOrEqual':
            return a >= b;
        case 'lessThan':
            return a < b;
        case 'lessThanOrEqual':
            return a <= b;
    }
}

export function applyLogic(
    operator: BooleanLogicNode['operator'],
    a: boolean,
    b: boolean
): boolean {
    switch (operator) {
        case 'and':
            return a && b;
        case 'or':
            return a || b;
        case 'xor':
            return a !== b;
        case 'nand':
            return !(a && b);
        case 'nor':
            return !(a || b);
        case 'xnor':
            return a === b;
    }
}

export function asNumber(value: WorkflowValue): number {
    if (typeof value !== 'number') {
        throw new AppError('INVALID_INPUT', `Expected number workflow value, got ${typeof value}`);
    }
    return value;
}

export function asBoolean(value: WorkflowValue): boolean {
    if (typeof value !== 'boolean') {
        throw new AppError('INVALID_INPUT', `Expected boolean workflow value, got ${typeof value}`);
    }
    return value;
}

export interface StreamNodeOptions<TValue extends WorkflowValue> {
    inputs: Record<string, WorkflowInput>;
    output: WorkflowOutput;
    signal: AbortSignal;
    inputNames: string[];
    read: (value: WorkflowValue) => TValue;
    compute: (values: Record<string, TValue>) => WorkflowValue | Promise<WorkflowValue>;
}

export async function executeStreamNode<TValue extends WorkflowValue>({
    inputs,
    output,
    signal,
    inputNames,
    read,
    compute
}: StreamNodeOptions<TValue>): Promise<void> {
    let stream = false;
    const latest: Record<string, TValue> = {};
    const hasAllInputs = (): boolean => inputNames.every((inputName) => inputName in latest);
    const emit = async (): Promise<void> => {
        const value = await compute(latest);
        output.emit(0, createWorkflowValueEvent(value));
    };

    inputs.stream?.subscribe((value) => {
        stream = asBoolean(value);
    });

    for (const inputName of inputNames) {
        inputs[inputName]?.subscribe((value) => {
            latest[inputName] = read(value);
            if (stream && hasAllInputs()) void emit().catch(() => undefined);
        });
    }

    const results = await Promise.all(
        inputNames.map((inputName) =>
            requireInput(inputs[inputName], `${inputName} input is required`)
        )
    );
    throwIfAborted(signal);
    const terminal = results.find((result) => result.status !== 'value');
    if (terminal) {
        output.emit(0, terminal);
        return;
    }

    for (const [index, result] of results.entries()) {
        if (result.status === 'value') latest[inputNames[index]] = read(result.value);
    }
    await emit();
}
