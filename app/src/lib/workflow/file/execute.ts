import { FileService } from '$lib/services/content/file';
import { ChatService } from '$lib/services/content/chat';
import { RoomService } from '$lib/services/content/room';
import { getActiveSession } from '$lib/services/session';
import { AppError } from '$lib/types/errors';
import type { DataScopeType } from '$lib/adapters/db';
import type { FileNamespace } from '../types';
import type {
    FileReadNode,
    FileWriteNode,
    WorkflowInputStream,
    WorkflowNodeExecutionContext,
    WorkflowNodeStream
} from '../types';
import { createWorkflowStreamState, workflowValueToString } from '../value';

interface ResolvedFileNamespace {
    namespaceId: string;
    scopeType: DataScopeType;
}

export async function* executeFileReadNode({
    node,
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<FileReadNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    const [path, target] = await Promise.all([
        resolvePath(inputs.path),
        resolveNamespace(node.namespace, ctx)
    ]);
    throwIfAborted(signal);

    const file = await FileService.getByPath(node.namespace, target.namespaceId, path);
    if (!file) throw new AppError('NOT_FOUND', `File not found: ${node.namespace}:${path}`);

    yield createWorkflowStreamState(file.content, 'string');
}

export async function* executeFileWriteNode({
    node,
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<FileWriteNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    const contentInput = inputs.content;
    if (!contentInput) {
        throw new AppError('INVALID_INPUT', `FileWrite content input is required: ${node.id}`);
    }

    const [path, rawContent, target] = await Promise.all([
        resolvePath(inputs.path),
        contentInput.final(),
        resolveNamespace(node.namespace, ctx)
    ]);
    throwIfAborted(signal);

    const content = workflowValueToString(rawContent);
    await FileService.upsert(node.namespace, target.namespaceId, path, content, target.scopeType);
    throwIfAborted(signal);
    yield createWorkflowStreamState(content, 'string');
}

async function resolvePath(input?: WorkflowInputStream): Promise<string> {
    const path = input ? workflowValueToString(await input.final()) : '';
    if (!path.trim()) throw new AppError('INVALID_INPUT', 'File path is required');
    return path;
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

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Workflow run aborted', 'AbortError');
}
