import { defaultFileFields, type FileItem } from '$lib/services/content/resource';
import { getChat, saveChatFile } from '$lib/stores/content/chat';
import { getRoom, saveRoomFile } from '$lib/stores/content/room';
import { getAppSettings, saveGlobalFile } from '$lib/stores/content/settings';
import { AppError } from '$lib/types/errors';
import type { EntityListConfig } from '$lib/types/refs';
import { generateId } from '$lib/utils/id';
import { generateSortOrder, listItems } from '$lib/utils/ordering';
import type { FileNamespace, WorkflowInput, WorkflowNodeEvent } from '../types';
import type { FileReadNode, FileWriteNode, WorkflowNodeExecutionContext } from '../types';
import {
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';

interface ResolvedFileOwner {
    files: EntityListConfig<FileItem>;
    save: (file: FileItem) => Promise<void>;
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
        output.emit(0, pathResult);
        return;
    }

    const path = normalizePath(workflowValueToString(pathResult.value));
    const file = listItems(target.files).find((item) => item.path === path);
    if (!file) throw new AppError('NOT_FOUND', `File not found: ${node.namespace}:${path}`);

    output.emit(0, createWorkflowValueEvent(file.content));
}

export async function executeFileWriteNode({
    node,
    inputs,
    ctx,
    signal
}: WorkflowNodeExecutionContext<FileWriteNode>): Promise<void> {
    throwIfAborted(signal);
    const [pathResult, contentResult, target] = await Promise.all([
        resolvePathResult(inputs.path),
        requireInput(inputs.content, `FileWrite content input is required: ${node.id}`),
        resolveNamespace(node.namespace, ctx)
    ]);
    throwIfAborted(signal);

    if (pathResult.status !== 'value') return;
    if (contentResult.status !== 'value') return;

    const path = normalizePath(workflowValueToString(pathResult.value));
    const content = workflowValueToString(contentResult.value);
    const existing = listItems(target.files).find((item) => item.path === path);
    const file: FileItem = existing
        ? { ...existing, content, id: existing.id }
        : {
              ...defaultFileFields,
              path,
              content,
              id: generateId(),
              sortOrder: generateSortOrder(target.files.refs, target.files.folders)
          };
    await target.save(file);
    throwIfAborted(signal);
}

async function resolvePathResult(input: WorkflowInput | undefined): Promise<WorkflowNodeEvent> {
    const result = await requireInput(input, 'File path is required');
    if (result.status !== 'value') return result;
    normalizePath(workflowValueToString(result.value));
    return result;
}

function normalizePath(path: string): string {
    const normalized = path.trim();
    if (!normalized) throw new AppError('INVALID_INPUT', 'File path is required');
    return normalized;
}

async function resolveNamespace(
    namespace: FileNamespace,
    ctx: WorkflowNodeExecutionContext['ctx']
): Promise<ResolvedFileOwner> {
    switch (namespace) {
        case 'global': {
            const settings = await getAppSettings();
            return {
                files: settings.files,
                save: saveGlobalFile
            };
        }
        case 'room': {
            if (!ctx?.roomId) {
                throw new AppError('INVALID_INPUT', 'Room file namespace requires ctx.roomId');
            }
            const room = await getRoom(ctx.roomId);
            if (!room) throw new AppError('NOT_FOUND', `Room not found: ${ctx.roomId}`);
            return {
                files: room.files,
                save: (file) => saveRoomFile(room.id, file)
            };
        }
        case 'chat': {
            if (!ctx?.chatId) {
                throw new AppError('INVALID_INPUT', 'Chat file namespace requires ctx.chatId');
            }
            const chat = await getChat(ctx.chatId);
            if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
            return {
                files: chat.files,
                save: (file) => saveChatFile(chat.id, file)
            };
        }
    }
}
