import { executeAgentNode } from './agent/execute';
import { executeFileReadNode, executeFileWriteNode } from './file/execute';
import { AppError } from '$lib/types/errors';
import type {
    AgentNode,
    OutputNode,
    StringConcatNode,
    StringNode,
    WorkflowNodeExecutionContext,
    WorkflowNodeStream
} from './types';

export function executeWorkflowNode(context: WorkflowNodeExecutionContext): WorkflowNodeStream {
    switch (context.node.class) {
        case 'String':
            return executeStringNode({
                ...context,
                node: context.node
            });
        case 'Concat':
            return executeConcatNode({
                ...context,
                node: context.node
            });
        case 'Output':
            return executeOutputNode({
                ...context,
                node: context.node
            });
        case 'FileRead':
            return executeFileReadNode({
                ...context,
                node: context.node
            });
        case 'FileWrite':
            return executeFileWriteNode({
                ...context,
                node: context.node
            });
        case 'Agent':
            return executeAgentNode({
                ...context,
                node: context.node
            });
    }
}

async function* executeStringNode({
    node,
    signal
}: WorkflowNodeExecutionContext<StringNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    yield { content: node.content };
}

async function* executeConcatNode({
    node,
    inputs,
    signal
}: WorkflowNodeExecutionContext<StringConcatNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    const [a, b, separator] = await Promise.all([
        inputs.a?.final() ?? '',
        inputs.b?.final() ?? '',
        inputs.separator?.final() ?? ''
    ]);
    throwIfAborted(signal);
    const content = [a, b].join(separator);
    yield { content };
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
        yield state;
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}
