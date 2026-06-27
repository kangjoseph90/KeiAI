import { executeAgentNode } from './agent/execute';
import { executeFileReadNode, executeFileWriteNode } from './file/execute';
import {
    executeBooleanLogicNode,
    executeBooleanNode,
    executeBooleanNotNode,
    executeConcatNode,
    executeNumberCompareNode,
    executeNumberMathNode,
    executeNumberNode,
    executeStringIncludesNode,
    executeStringLengthNode,
    executeStringNode
} from './operator/execute';
import { AppError } from '$lib/types/errors';
import type { OutputNode, WorkflowNodeExecutionContext, WorkflowNodeStream } from './types';
import { createWorkflowStreamState } from './value';

export function executeWorkflowNode(context: WorkflowNodeExecutionContext): WorkflowNodeStream {
    switch (context.node.class) {
        case 'String':
            return executeStringNode({ ...context, node: context.node });
        case 'Number':
            return executeNumberNode({ ...context, node: context.node });
        case 'Boolean':
            return executeBooleanNode({ ...context, node: context.node });
        case 'Concat':
            return executeConcatNode({ ...context, node: context.node });
        case 'StringLength':
            return executeStringLengthNode({ ...context, node: context.node });
        case 'StringIncludes':
            return executeStringIncludesNode({ ...context, node: context.node });
        case 'NumberMath':
            return executeNumberMathNode({ ...context, node: context.node });
        case 'NumberCompare':
            return executeNumberCompareNode({ ...context, node: context.node });
        case 'BooleanLogic':
            return executeBooleanLogicNode({ ...context, node: context.node });
        case 'BooleanNot':
            return executeBooleanNotNode({ ...context, node: context.node });
        case 'Output':
            return executeOutputNode({ ...context, node: context.node });
        case 'FileRead':
            return executeFileReadNode({ ...context, node: context.node });
        case 'FileWrite':
            return executeFileWriteNode({ ...context, node: context.node });
        case 'Agent':
            return executeAgentNode({ ...context, node: context.node });
    }
}

async function* executeOutputNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<OutputNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    const input = inputs.content;
    if (!input) {
        throw new AppError('INVALID_INPUT', `Output content input is required: ${node.id}`);
    }

    for await (const state of input.stream()) {
        throwIfAborted(signal);
        yield createWorkflowStreamState(state.content, 'string');
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}
