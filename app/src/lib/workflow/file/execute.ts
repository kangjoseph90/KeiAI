import type { FileNamespace, WorkflowInput, WorkflowNodeEvent } from '../types';
import type { FileReadNode, FileWriteNode, WorkflowNodeExecutionContext } from '../types';
import {
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';
import { normalizeWorkflowFilePath, readWorkflowFile, writeWorkflowFile } from './operations';

export async function executeFileReadNode({
    node,
    inputs,
    ctx,
    output,
    signal
}: WorkflowNodeExecutionContext<FileReadNode>): Promise<void> {
    throwIfAborted(signal);
    const pathResult = await resolvePathResult(inputs.path);
    throwIfAborted(signal);

    if (pathResult.status !== 'value') {
        output.emit(0, pathResult);
        return;
    }

    const path = normalizeWorkflowFilePath(workflowValueToString(pathResult.value));
    const file = await readWorkflowFile(node.namespace, path, ctx);

    output.emit(0, createWorkflowValueEvent(file.content));
}

export async function executeFileWriteNode({
    node,
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<FileWriteNode>): Promise<void> {
    throwIfAborted(signal);
    const [pathResult, contentResult] = await Promise.all([
        resolvePathResult(inputs.path),
        requireInput(inputs.content, `FileWrite content input is required: ${node.id}`)
    ]);
    throwIfAborted(signal);

    if (pathResult.status !== 'value') return;
    if (contentResult.status !== 'value') return;

    const path = normalizeWorkflowFilePath(workflowValueToString(pathResult.value));
    const content = workflowValueToString(contentResult.value);
    await writeWorkflowFile(node.namespace, path, content, ctx);
    throwIfAborted(signal);
}

async function resolvePathResult(input: WorkflowInput | undefined): Promise<WorkflowNodeEvent> {
    const result = await requireInput(input, 'File path is required');
    if (result.status !== 'value') return result;
    normalizeWorkflowFilePath(workflowValueToString(result.value));
    return result;
}
