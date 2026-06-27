import { executeAgentNode } from './agent/execute';
import { executeFileReadNode, executeFileWriteNode } from './file/execute';
import type {
    AgentNode,
    OutputNode,
    StringConcatNode,
    StringNode,
    WorkflowNode,
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
    const inputNames = Object.keys(node.inputs);
    const values = await Promise.all(inputNames.map((name) => inputs[name]?.final() ?? ''));
    const content = values.join(node.separator);
    yield { content };
}

async function* executeOutputNode({
    inputs,
    signal
}: WorkflowNodeExecutionContext<OutputNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    const input = firstInput(inputs);
    if (!input) {
        yield { content: '' };
        return;
    }

    for await (const state of input.stream()) {
        throwIfAborted(signal);
        yield state;
    }
}

function firstInput(inputs: WorkflowNodeExecutionContext['inputs']) {
    return Object.values(inputs)[0];
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}

export type { WorkflowNode };
