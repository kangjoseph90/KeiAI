import { FileService } from '$lib/services/content/file';
import { ChatService } from '$lib/services/content/chat';
import { RoomService } from '$lib/services/content/room';
import { getActiveSession } from '$lib/services/session';
import { AppError } from '$lib/types/errors';
import type { DataScopeType } from '$lib/adapters/db';
import type { FileNamespace, WorkflowInput, WorkflowNodeEvent } from '../types';
import type { FileReadNode, FileWriteNode, WorkflowNodeExecutionContext } from '../types';
import {
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';

interface ResolvedFileNamespace {
    namespaceId: string;
    scopeType: DataScopeType;
}

export async function executeFileReadNode({
    node,
    inputs,
    ctx,
    output,
    signal
}: WorkflowNodeExecutionContext<FileReadNode>): Promise<void> {
    throwIfAborted(signal);
    const [pathResult, target] = await Promise.all([
        resolvePathResult(inputs.path),
        resolveNamespace(node.namespace, ctx)
    ]);
    throwIfAborted(signal);

    if (pathResult.status !== 'value') {
        output.emit(pathResult);
        return;
    }

    const path = workflowValueToString(pathResult.value);
    const file = await FileService.getByPath(node.namespace, target.namespaceId, path);
    if (!file) throw new AppError('NOT_FOUND', `File not found: ${node.namespace}:${path}`);

    output.emit(createWorkflowValueEvent(file.content));
}

export async function executeFileWriteNode({
    node,
    inputs,
    ctx,
    output,
    signal
}: WorkflowNodeExecutionContext<FileWriteNode>): Promise<void> {
    throwIfAborted(signal);
    const [pathResult, contentResult, target] = await Promise.all([
        resolvePathResult(inputs.path),
        requireInput(inputs.content, `FileWrite content input is required: ${node.id}`),
        resolveNamespace(node.namespace, ctx)
    ]);
    throwIfAborted(signal);

    if (pathResult.status !== 'value') {
        output.emit(pathResult);
        return;
    }
    if (contentResult.status !== 'value') {
        output.emit(contentResult);
        return;
    }

    const path = workflowValueToString(pathResult.value);
    const content = workflowValueToString(contentResult.value);
    await FileService.upsert(node.namespace, target.namespaceId, path, content, target.scopeType);
    throwIfAborted(signal);
    output.emit(createWorkflowValueEvent(content));
}

async function resolvePathResult(input: WorkflowInput | undefined): Promise<WorkflowNodeEvent> {
    const result = await requireInput(input, 'File path is required');
    if (result.status !== 'value') return result;
    const path = workflowValueToString(result.value);
    if (!path.trim()) throw new AppError('INVALID_INPUT', 'File path is required');
    return result;
}

async function resolveNamespace(
    namespace: FileNamespace,
    ctx: WorkflowNodeExecutionContext['ctx']
): Promise<ResolvedFileNamespace> {
    switch (namespace) {
        case 'global':
            return { namespaceId: getActiveSession().userId, scopeType: 'user' };
        case 'room': {
            if (!ctx?.roomId) {
                throw new AppError('INVALID_INPUT', 'Room file namespace requires ctx.roomId');
            }
            const room = await RoomService.get(ctx.roomId);
            if (!room) throw new AppError('NOT_FOUND', `Room not found: ${ctx.roomId}`);
            return { namespaceId: room.id, scopeType: room.scopeType };
        }
        case 'chat': {
            if (!ctx?.chatId) {
                throw new AppError('INVALID_INPUT', 'Chat file namespace requires ctx.chatId');
            }
            const chat = await ChatService.get(ctx.chatId);
            if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
            return { namespaceId: chat.id, scopeType: chat.scopeType };
        }
    }
}
