import { defaultFileFields, type FileItem } from '$lib/services/content/resource';
import { getChat, saveChatFile } from '$lib/stores/content/chat';
import { getRoom, saveRoomFile } from '$lib/stores/content/room';
import { getAppSettings, saveGlobalFile } from '$lib/stores/content/settings';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';
import type { EntityListConfig } from '$lib/types/refs';
import { generateId } from '$lib/utils/id';
import { generateSortOrder, listItems } from '$lib/utils/ordering';
import type { FileNamespace } from '../types';

interface ResolvedFileOwner {
    files: EntityListConfig<FileItem>;
    save: (file: FileItem) => Promise<void>;
}

export interface FileWriteResult {
    created: boolean;
    file: FileItem;
}

export async function readWorkflowFile(
    namespace: FileNamespace,
    path: string,
    ctx?: RuntimeContext
): Promise<FileItem> {
    const normalizedPath = normalizeWorkflowFilePath(path);
    const target = await resolveFileNamespace(namespace, ctx);
    const file = listItems(target.files).find((item) => item.path === normalizedPath);
    if (!file) throw new AppError('NOT_FOUND', `File not found: ${namespace}:${normalizedPath}`);
    return file;
}

export async function writeWorkflowFile(
    namespace: FileNamespace,
    path: string,
    content: string,
    ctx?: RuntimeContext
): Promise<FileWriteResult> {
    const normalizedPath = normalizeWorkflowFilePath(path);
    const target = await resolveFileNamespace(namespace, ctx);
    const existing = listItems(target.files).find((item) => item.path === normalizedPath);
    const file: FileItem = existing
        ? { ...existing, content, id: existing.id }
        : {
              ...defaultFileFields,
              path: normalizedPath,
              content,
              id: generateId(),
              sortOrder: generateSortOrder(target.files.refs, target.files.folders)
          };
    await target.save(file);
    return { created: !existing, file };
}

export function normalizeWorkflowFilePath(path: string): string {
    const normalized = path.trim();
    if (!normalized) throw new AppError('INVALID_INPUT', 'File path is required');
    return normalized;
}

async function resolveFileNamespace(
    namespace: FileNamespace,
    ctx?: RuntimeContext
): Promise<ResolvedFileOwner> {
    switch (namespace) {
        case 'global': {
            const settings = await getAppSettings();
            return { files: settings.files, save: saveGlobalFile };
        }
        case 'room': {
            if (!ctx?.roomId) {
                throw new AppError('INVALID_INPUT', 'Room file namespace requires ctx.roomId');
            }
            const room = await getRoom(ctx.roomId);
            if (!room) throw new AppError('NOT_FOUND', `Room not found: ${ctx.roomId}`);
            return { files: room.files, save: (file) => saveRoomFile(room.id, file) };
        }
        case 'chat': {
            if (!ctx?.chatId) {
                throw new AppError('INVALID_INPUT', 'Chat file namespace requires ctx.chatId');
            }
            const chat = await getChat(ctx.chatId);
            if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
            return { files: chat.files, save: (file) => saveChatFile(chat.id, file) };
        }
    }
}
