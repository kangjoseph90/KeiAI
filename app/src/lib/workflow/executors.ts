import { executeAgentNode } from './agent/execute';
import { executeFileReadNode, executeFileWriteNode } from './file/execute';
import {
    executeBooleanLogicNode,
    executeBooleanNode,
    executeBooleanNotNode,
    executeCatchNode,
    executeConcatNode,
    executeGateNode,
    executeGetChatVarNode,
    executeGetToggleNode,
    executeNumberCompareNode,
    executeNumberMathNode,
    executeNumberNode,
    executeSetChatVarNode,
    executeStringIncludesNode,
    executeStringLengthNode,
    executeStringRegexReplaceNode,
    executeStringReplaceNode,
    executeStringNode,
    executeTemplateNode,
    executeThrowIfNode,
    executeToBooleanNode,
    executeToNumberNode,
    executeUngateNode
} from './operator/execute';
import { AppError } from '$lib/types/errors';
import type {
    OutputNode,
    WorkflowNode,
    WorkflowNodeClass,
    WorkflowNodeExecutionContext
} from './types';
import { createWorkflowValueEvent, throwIfAborted, workflowValueToString } from './util';

type WorkflowNodeExecutor<TNode extends WorkflowNode = WorkflowNode> = (
    context: WorkflowNodeExecutionContext<TNode>
) => void | Promise<void>;

// Registry mapping WorkflowNodeClass to respective executors, keeping dynamic dispatch type-safe.
const WORKFLOW_NODE_EXECUTORS = {
    String: executeStringNode,
    Number: executeNumberNode,
    Boolean: executeBooleanNode,
    Template: executeTemplateNode,
    GetToggle: executeGetToggleNode,
    GetChatVar: executeGetChatVarNode,
    SetChatVar: executeSetChatVarNode,
    ToBoolean: executeToBooleanNode,
    ToNumber: executeToNumberNode,
    Catch: executeCatchNode,
    ThrowIf: executeThrowIfNode,
    Concat: executeConcatNode,
    StringLength: executeStringLengthNode,
    StringIncludes: executeStringIncludesNode,
    StringReplace: executeStringReplaceNode,
    StringRegexReplace: executeStringRegexReplaceNode,
    NumberMath: executeNumberMathNode,
    NumberCompare: executeNumberCompareNode,
    BooleanLogic: executeBooleanLogicNode,
    BooleanNot: executeBooleanNotNode,
    Gate: executeGateNode,
    Ungate: executeUngateNode,
    Output: executeOutputNode,
    FileRead: executeFileReadNode,
    FileWrite: executeFileWriteNode,
    Agent: executeAgentNode
} as Record<WorkflowNodeClass, WorkflowNodeExecutor<WorkflowNode>>;

export function executeWorkflowNode(context: WorkflowNodeExecutionContext): void | Promise<void> {
    return WORKFLOW_NODE_EXECUTORS[context.node.class](context);
}

async function executeOutputNode({
    node,
    inputs,
    emitRuntimeOutput,
    signal
}: WorkflowNodeExecutionContext<OutputNode>): Promise<void> {
    throwIfAborted(signal);
    const input = inputs.content;
    if (!input) {
        throw new AppError('INVALID_INPUT', `Output content input is required: ${node.id}`);
    }

    // Passthrough: stream every intermediate value.
    input.subscribe((value) => {
        emitRuntimeOutput(createWorkflowValueEvent(workflowValueToString(value)));
    });

    const result = await input.done;
    throwIfAborted(signal);
    if (result.status !== 'value') {
        emitRuntimeOutput(result);
    }
}
