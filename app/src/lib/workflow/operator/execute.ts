import { AppError } from '$lib/types/errors';
import type {
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    GateNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    UngateNode,
    WorkflowInput,
    WorkflowNodeExecutionContext,
    WorkflowValue
} from '../types';
import {
    createWorkflowSkipEvent,
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';

export async function executeStringNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<StringNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(createWorkflowValueEvent(node.content));
}

export async function executeNumberNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(createWorkflowValueEvent(node.value));
}

export async function executeBooleanNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(createWorkflowValueEvent(node.value));
}

export async function executeConcatNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringConcatNode>): Promise<void> {
    const latest = { a: '', b: '', separator: '' };
    const emit = () =>
        output.emit(createWorkflowValueEvent([latest.a, latest.b].join(latest.separator)));

    inputs.a?.subscribe((v) => {
        latest.a = String(v);
        emit();
    });
    inputs.b?.subscribe((v) => {
        latest.b = String(v);
        emit();
    });
    inputs.separator?.subscribe((v) => {
        latest.separator = String(v);
        emit();
    });

    const [aResult, bResult, sepResult] = await Promise.all([
        requireInput(inputs.a, 'Input A is required'),
        requireInput(inputs.b, 'Input B is required'),
        requireInput(inputs.separator, 'Separator is required')
    ]);
    throwIfAborted(signal);

    const terminal = [aResult, bResult, sepResult].find((r) => r.status !== 'value');
    if (terminal) {
        output.emit(terminal);
    }
}

export async function executeStringLengthNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringLengthNode>): Promise<void> {
    const result = await requireInput(inputs.value, 'StringLength value input is required');
    throwIfAborted(signal);
    if (result.status !== 'value') {
        output.emit(result);
        return;
    }
    output.emit(createWorkflowValueEvent(workflowValueToString(result.value).length));
}

export async function executeStringIncludesNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringIncludesNode>): Promise<void> {
    const [textResult, searchResult] = await Promise.all([
        requireInput(inputs.text, 'StringIncludes text input is required'),
        requireInput(inputs.search, 'StringIncludes search input is required')
    ]);
    throwIfAborted(signal);
    if (textResult.status !== 'value') return output.emit(textResult);
    if (searchResult.status !== 'value') return output.emit(searchResult);

    const text = workflowValueToString(textResult.value);
    const search = workflowValueToString(searchResult.value);
    output.emit(
        createWorkflowValueEvent(
            node.caseSensitive
                ? text.includes(search)
                : text.toLowerCase().includes(search.toLowerCase())
        )
    );
}

export async function executeNumberMathNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberMathNode>): Promise<void> {
    const [aResult, bResult] = await Promise.all([
        requireInput(inputs.a, 'NumberMath a input is required'),
        requireInput(inputs.b, 'NumberMath b input is required')
    ]);
    throwIfAborted(signal);
    if (aResult.status !== 'value') return output.emit(aResult);
    if (bResult.status !== 'value') return output.emit(bResult);

    output.emit(
        createWorkflowValueEvent(
            applyMath(node.operator, asNumber(aResult.value), asNumber(bResult.value), node.id)
        )
    );
}

export async function executeNumberCompareNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberCompareNode>): Promise<void> {
    const [aResult, bResult] = await Promise.all([
        requireInput(inputs.a, 'NumberCompare a input is required'),
        requireInput(inputs.b, 'NumberCompare b input is required')
    ]);
    throwIfAborted(signal);
    if (aResult.status !== 'value') return output.emit(aResult);
    if (bResult.status !== 'value') return output.emit(bResult);

    output.emit(
        createWorkflowValueEvent(
            applyCompare(node.operator, asNumber(aResult.value), asNumber(bResult.value))
        )
    );
}

export async function executeBooleanLogicNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanLogicNode>): Promise<void> {
    const [aResult, bResult] = await Promise.all([
        requireInput(inputs.a, 'BooleanLogic a input is required'),
        requireInput(inputs.b, 'BooleanLogic b input is required')
    ]);
    throwIfAborted(signal);
    if (aResult.status !== 'value') return output.emit(aResult);
    if (bResult.status !== 'value') return output.emit(bResult);

    output.emit(
        createWorkflowValueEvent(
            applyLogic(node.operator, asBoolean(aResult.value), asBoolean(bResult.value))
        )
    );
}

export async function executeBooleanNotNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanNotNode>): Promise<void> {
    const result = await requireInput(inputs.value, 'BooleanNot value input is required');
    throwIfAborted(signal);
    if (result.status !== 'value') {
        output.emit(result);
        return;
    }
    output.emit(createWorkflowValueEvent(!asBoolean(result.value)));
}

export async function executeGateNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<GateNode>): Promise<void> {
    throwIfAborted(signal);
    const result = await requireInput(inputs.condition, 'Boolean condition input is required');
    if (result.status !== 'value') {
        output.emit(result);
        return;
    }
    if (!asBoolean(result.value)) {
        output.emit(createWorkflowSkipEvent('Gate condition was false'));
        return;
    }
    output.emit(createWorkflowValueEvent(true));
}

export async function executeUngateNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<UngateNode>): Promise<void> {
    throwIfAborted(signal);
    const result = await requireInput(inputs.condition, 'Boolean condition input is required');
    if (result.status === 'error') {
        output.emit(result);
        return;
    }
    if (result.status === 'skip') {
        output.emit(createWorkflowValueEvent(false));
        return;
    }
    output.emit(createWorkflowValueEvent(asBoolean(result.value)));
}

function applyMath(
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

function applyCompare(operator: NumberCompareNode['operator'], a: number, b: number): boolean {
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

function applyLogic(operator: BooleanLogicNode['operator'], a: boolean, b: boolean): boolean {
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
