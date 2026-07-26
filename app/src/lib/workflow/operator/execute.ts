import { getChatVariable, setChatVariable } from '$lib/managers/chat';
import { getToggleMacroValue } from '$lib/managers/toggle';
import { runTemplate, createDryRunMacros, mergeLocalMacros } from '$lib/template';
import { AppError } from '$lib/types/errors';
import type {
    AgentPartFilterNode,
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    CatchNode,
    GateNode,
    GetChatVarNode,
    GetToggleNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    SetChatVarNode,
    SinkNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    StringRegexReplaceNode,
    StringReplaceNode,
    TemplateNode,
    ThrowIfNode,
    ToBooleanNode,
    ToNumberNode,
    UngateNode,
    WorkflowNodeExecutionContext
} from '../types';
import { deserializeAgentParts, serializeAgentParts } from '../agent/llm';
import {
    createWorkflowErrorEvent,
    createWorkflowSkipEvent,
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';
import {
    applyCompare,
    applyLogic,
    applyMath,
    asBoolean,
    asNumber,
    executeStreamNode,
    parseBoolean,
    parseNumber,
    requireStringInput,
    requireWorkflowInput
} from './utils';

export async function executeStringNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<StringNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(0, createWorkflowValueEvent(node.content));
}

export async function executeNumberNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(0, createWorkflowValueEvent(node.value));
}

export async function executeBooleanNode({
    node,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanNode>): Promise<void> {
    throwIfAborted(signal);
    output.emit(0, createWorkflowValueEvent(node.value));
}

export async function executeTemplateNode({
    inputs,
    output,
    ctx,
    localMacros,
    signal
}: WorkflowNodeExecutionContext<TemplateNode>): Promise<void> {
    if (!ctx) throw new AppError('INVALID_INPUT', 'Template node requires runtime context');
    const dryRunMacros = mergeLocalMacros(localMacros, createDryRunMacros());
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['content'],
        read: workflowValueToString,
        compute: async ({ content }) => runTemplate(content, ctx, dryRunMacros)
    });
}

export async function executeGetToggleNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<GetToggleNode>): Promise<void> {
    const name = await requireStringInput(inputs.name, 'Variable name input is required', signal);
    const value = await getToggleMacroValue(name);
    output.emit(0, createWorkflowValueEvent(value));
}

export async function executeGetChatVarNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<GetChatVarNode>): Promise<void> {
    if (!ctx?.chatId) throw new AppError('INVALID_INPUT', 'GetChatVar requires ctx.chatId');
    const name = await requireStringInput(inputs.name, 'GetChatVar name input is required', signal);
    output.emit(0, createWorkflowValueEvent((await getChatVariable(ctx.chatId, name)) ?? ''));
}

export async function executeSetChatVarNode({
    node,
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<SetChatVarNode>): Promise<void> {
    if (!ctx?.chatId) throw new AppError('INVALID_INPUT', 'SetChatVar requires ctx.chatId');
    const [nameResult, contentResult] = await Promise.all([
        requireInput(inputs.name, `SetChatVar name input is required: ${node.id}`),
        requireInput(inputs.content, `SetChatVar content input is required: ${node.id}`)
    ]);
    throwIfAborted(signal);
    if (nameResult.status !== 'value') return;
    if (contentResult.status !== 'value') return;
    await setChatVariable(
        ctx.chatId,
        workflowValueToString(nameResult.value),
        workflowValueToString(contentResult.value)
    );
}

export async function executeSinkNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<SinkNode>): Promise<void> {
    // Sink has no output and no side effect; its sole purpose is to drive execution
    // of its dependency chain by awaiting the terminal event of its input.
    const input = requireWorkflowInput(inputs.content, 'Sink content input is required');
    await input.done;
    throwIfAborted(signal);
}

export async function executeToBooleanNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<ToBooleanNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['content'],
        read: workflowValueToString,
        compute: ({ content }) => parseBoolean(content, node.id)
    });
}

export async function executeToNumberNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<ToNumberNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['content'],
        read: workflowValueToString,
        compute: ({ content }) => parseNumber(content, node.id)
    });
}

export async function executeCatchNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<CatchNode>): Promise<void> {
    const valueInput = requireWorkflowInput(inputs.value, 'Catch value input is required');
    const valueResult = await valueInput.done;
    throwIfAborted(signal);

    if (valueResult.status === 'error') {
        const fallback = await requireInput(inputs.fallback, 'Catch fallback input is required');
        throwIfAborted(signal);
        if (fallback.status !== 'value') {
            output.emit(0, fallback);
            return;
        }
        output.emit(0, createWorkflowValueEvent(workflowValueToString(fallback.value)));
        output.emit(1, createWorkflowValueEvent(true));
        return;
    }

    if (valueResult.status !== 'value') {
        output.emit(0, valueResult);
        return;
    }
    output.emit(0, createWorkflowValueEvent(workflowValueToString(valueResult.value)));
    output.emit(1, createWorkflowValueEvent(false));
}

export async function executeThrowIfNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<ThrowIfNode>): Promise<void> {
    const conditionResult = await requireInput(
        inputs.condition,
        'ThrowIf condition input is required'
    );
    throwIfAborted(signal);
    if (conditionResult.status !== 'value') {
        output.emit(0, conditionResult);
        return;
    }
    if (asBoolean(conditionResult.value)) {
        // Error/skip events are terminal for the whole node; the port number is only API shape.
        output.emit(
            0,
            createWorkflowErrorEvent(
                node,
                new AppError('INVALID_INPUT', `ThrowIf condition was true: ${node.id}`)
            )
        );
        return;
    }
    const value = await requireInput(inputs.value, 'ThrowIf value input is required');
    throwIfAborted(signal);
    output.emit(0, value);
}

export async function executeConcatNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringConcatNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['a', 'b', 'separator'],
        read: workflowValueToString,
        compute: ({ a, b, separator }) => [a, b].join(separator)
    });
}

export async function executeStringLengthNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringLengthNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['value'],
        read: workflowValueToString,
        compute: ({ value }) => value.length
    });
}

export async function executeStringIncludesNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringIncludesNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['text', 'search'],
        read: workflowValueToString,
        compute: ({ text, search }) =>
            node.caseSensitive
                ? text.includes(search)
                : text.toLowerCase().includes(search.toLowerCase())
    });
}

export async function executeStringReplaceNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringReplaceNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['text', 'search', 'replace'],
        read: workflowValueToString,
        compute: ({ text, search, replace }) => (search ? text.split(search).join(replace) : text)
    });
}

export async function executeStringRegexReplaceNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<StringRegexReplaceNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['text', 'regex', 'replace'],
        read: workflowValueToString,
        compute: ({ text, regex, replace }) => {
            if (!regex) return text;
            return text.replace(new RegExp(regex, node.flags), replace);
        }
    });
}

export async function executeAgentPartFilterNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<AgentPartFilterNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['content'],
        read: workflowValueToString,
        compute: ({ content }) =>
            serializeAgentParts(
                deserializeAgentParts(content).filter((part) => {
                    switch (part.type) {
                        case 'text':
                            return node.includeText;
                        case 'thought':
                            return node.includeThought;
                        case 'inlay':
                            return node.includeInlay;
                        case 'tool_calls':
                            return node.includeToolCalls;
                    }
                })
            )
    });
}

export async function executeNumberMathNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberMathNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['a', 'b'],
        read: asNumber,
        compute: ({ a, b }) => applyMath(node.operator, a, b, node.id)
    });
}

export async function executeNumberCompareNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<NumberCompareNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['a', 'b'],
        read: asNumber,
        compute: ({ a, b }) => applyCompare(node.operator, a, b)
    });
}

export async function executeBooleanLogicNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanLogicNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['a', 'b'],
        read: asBoolean,
        compute: ({ a, b }) => applyLogic(node.operator, a, b)
    });
}

export async function executeBooleanNotNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<BooleanNotNode>): Promise<void> {
    await executeStreamNode({
        inputs,
        output,
        signal,
        inputNames: ['value'],
        read: asBoolean,
        compute: ({ value }) => !value
    });
}

export async function executeGateNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<GateNode>): Promise<void> {
    const condition = await requireInput(inputs.condition, 'Gate condition input is required');
    throwIfAborted(signal);
    if (condition.status !== 'value') {
        output.emit(0, condition);
        return;
    }
    if (!asBoolean(condition.value)) {
        output.emit(0, createWorkflowSkipEvent('Gate condition was false'));
        return;
    }
    const value = await requireInput(inputs.value, 'Gate value input is required');
    throwIfAborted(signal);
    output.emit(0, value);
}

export async function executeUngateNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<UngateNode>): Promise<void> {
    const value = await requireInput(inputs.value, 'Ungate value input is required');
    throwIfAborted(signal);

    if (value.status === 'error') {
        output.emit(0, value);
        return;
    }
    if (value.status === 'skip') {
        const fallback = await requireInput(inputs.fallback, 'Ungate fallback input is required');
        throwIfAborted(signal);
        if (fallback.status !== 'value') {
            output.emit(0, fallback);
            return;
        }
        output.emit(0, createWorkflowValueEvent(workflowValueToString(fallback.value)));
        output.emit(1, createWorkflowValueEvent(true));
        return;
    }

    output.emit(0, createWorkflowValueEvent(workflowValueToString(value.value)));
    output.emit(1, createWorkflowValueEvent(false));
}
