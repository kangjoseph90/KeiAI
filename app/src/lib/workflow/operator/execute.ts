import { getChatVariable, setChatVariable } from '$lib/managers/chat';
import { getGlobalVariable, setGlobalVariable } from '$lib/managers/preset';
import { runTemplate, createDryRunMacros, mergeLocalMacros } from '$lib/template';
import { AppError } from '$lib/types/errors';
import type {
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    CatchNode,
    GateNode,
    GetChatVarNode,
    GetGlobalVarNode,
    GetToggleNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    SetChatVarNode,
    SetGlobalVarNode,
    SetToggleNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    StringRegexReplaceNode,
    StringReplaceNode,
    TemplateNode,
    ThrowNode,
    ToBooleanNode,
    ToNumberNode,
    UngateNode,
    WorkflowNodeExecutionContext
} from '../types';
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
    requireNameAndContent,
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
    const value = await getGlobalVariable(`toggle_${name}`);
    output.emit(0, createWorkflowValueEvent(value ?? 'null'));
}

export async function executeSetToggleNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<SetToggleNode>): Promise<void> {
    const { name, content } = await requireNameAndContent(inputs, signal);
    await setGlobalVariable(`toggle_${name}`, content);
}

export async function executeGetGlobalVarNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<GetGlobalVarNode>): Promise<void> {
    const name = await requireStringInput(inputs.name, 'Variable name input is required', signal);
    const value = await getGlobalVariable(name);
    output.emit(0, createWorkflowValueEvent(value ?? 'null'));
}

export async function executeSetGlobalVarNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<SetGlobalVarNode>): Promise<void> {
    const { name, content } = await requireNameAndContent(inputs, signal);
    await setGlobalVariable(name, content);
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
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<SetChatVarNode>): Promise<void> {
    if (!ctx?.chatId) throw new AppError('INVALID_INPUT', 'SetChatVar requires ctx.chatId');
    const { name, content } = await requireNameAndContent(inputs, signal);
    await setChatVariable(ctx.chatId, name, content);
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
    const tryInput = requireWorkflowInput(inputs.try, 'Catch try input is required');
    const tryResult = await tryInput.done;
    throwIfAborted(signal);

    if (tryResult.status === 'error') {
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

    if (tryResult.status !== 'value') {
        output.emit(0, tryResult);
        return;
    }
    output.emit(0, createWorkflowValueEvent(workflowValueToString(tryResult.value)));
    output.emit(1, createWorkflowValueEvent(false));
}

export async function executeThrowNode({
    node,
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<ThrowNode>): Promise<void> {
    const result = await requireInput(inputs.condition, 'Throw condition input is required');
    throwIfAborted(signal);
    if (result.status !== 'value') {
        output.emit(0, result);
        return;
    }
    const condition = asBoolean(result.value);
    if (condition) {
        // Error/skip events are terminal for the whole node; the port number is only API shape.
        output.emit(
            0,
            createWorkflowErrorEvent(
                node,
                new AppError('INVALID_INPUT', `Throw condition was true: ${node.id}`)
            )
        );
        return;
    }
    output.emit(0, createWorkflowValueEvent(false));
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
    const result = await requireInput(inputs.condition, 'Gate condition input is required');
    throwIfAborted(signal);
    if (result.status !== 'value') {
        output.emit(0, result);
        return;
    }
    if (!asBoolean(result.value)) {
        output.emit(0, createWorkflowSkipEvent('Gate condition was false'));
        return;
    }
    output.emit(0, createWorkflowValueEvent(true));
}

export async function executeUngateNode({
    inputs,
    output,
    signal
}: WorkflowNodeExecutionContext<UngateNode>): Promise<void> {
    const gate = await requireInput(inputs.gate, 'Ungate gate input is required');
    throwIfAborted(signal);

    if (gate.status === 'error') {
        output.emit(0, gate);
        return;
    }
    if (gate.status === 'skip') {
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

    output.emit(0, createWorkflowValueEvent(workflowValueToString(gate.value)));
    output.emit(1, createWorkflowValueEvent(false));
}
