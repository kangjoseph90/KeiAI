import { AppError } from '$lib/types/errors';
import type {
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    WorkflowNodeExecutionContext,
    WorkflowNodeStream,
    WorkflowValue
} from '../types';
import { createWorkflowStreamState } from '../value';
import { executeStreamingOperator } from './stream';

export async function* executeStringNode({
    node,
    signal
}: WorkflowNodeExecutionContext<StringNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    yield createWorkflowStreamState(node.content, 'string');
}

export async function* executeNumberNode({
    node,
    signal
}: WorkflowNodeExecutionContext<NumberNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    yield createWorkflowStreamState(node.value, 'number');
}

export async function* executeBooleanNode({
    node,
    signal
}: WorkflowNodeExecutionContext<BooleanNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    yield createWorkflowStreamState(node.value, 'boolean');
}

export async function* executeConcatNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<StringConcatNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { a: '', b: '', separator: '' },
        'string',
        (latest) => [asString(latest.a), asString(latest.b)].join(asString(latest.separator)),
        signal
    );
}

export async function* executeStringLengthNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<StringLengthNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { value: '' },
        'number',
        (latest) => asString(latest.value).length,
        signal
    );
}

export async function* executeStringIncludesNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<StringIncludesNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { text: '', search: '' },
        'boolean',
        (latest) => {
            const text = asString(latest.text);
            const search = asString(latest.search);
            if (node.caseSensitive) return text.includes(search);
            return text.toLowerCase().includes(search.toLowerCase());
        },
        signal
    );
}

export async function* executeNumberMathNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<NumberMathNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { a: 0, b: 0 },
        'number',
        (latest) => {
            const a = asNumber(latest.a);
            const b = asNumber(latest.b);
            switch (node.operator) {
                case 'add':
                    return a + b;
                case 'subtract':
                    return a - b;
                case 'multiply':
                    return a * b;
                case 'divide':
                    if (b === 0) {
                        throw new AppError('INVALID_INPUT', `Cannot divide by zero: ${node.id}`);
                    }
                    return a / b;
            }
        },
        signal
    );
}

export async function* executeNumberCompareNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<NumberCompareNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { a: 0, b: 0 },
        'boolean',
        (latest) => {
            const a = asNumber(latest.a);
            const b = asNumber(latest.b);
            switch (node.operator) {
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
        },
        signal
    );
}

export async function* executeBooleanLogicNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<BooleanLogicNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { a: false, b: false },
        'boolean',
        (latest) => {
            const a = asBoolean(latest.a);
            const b = asBoolean(latest.b);
            switch (node.operator) {
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
        },
        signal
    );
}

export async function* executeBooleanNotNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<BooleanNotNode>): WorkflowNodeStream {
    yield* executeStreamingOperator(
        inputs,
        { value: false },
        'boolean',
        (latest) => !asBoolean(latest.value),
        signal
    );
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}

function asString(value: WorkflowValue): string {
    return String(value);
}

function asNumber(value: WorkflowValue): number {
    if (typeof value !== 'number') {
        throw new AppError('INVALID_INPUT', `Expected number workflow value, got ${typeof value}`);
    }
    return value;
}

function asBoolean(value: WorkflowValue): boolean {
    if (typeof value !== 'boolean') {
        throw new AppError('INVALID_INPUT', `Expected boolean workflow value, got ${typeof value}`);
    }
    return value;
}
