import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../user';
import { localDB, type ChatRecord } from '$lib/adapters/db';
import type { EntityListConfig, ResourceRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ChatContent {
    title: string;
    chatNote: string;
}

export interface ChatRefs {
    lastMessageId?: string;
    greetingMessageId?: string;
    defaultPersonaId?: string;
    defaultCharacterId?: string;
    selectedPersonaId?: string;
    selectedCharacterId?: string;
    lorebooks: EntityListConfig;
    personas: EntityListConfig<ResourceRef>;
}

export interface ChatFields extends ChatContent, ChatRefs {}

export interface Chat extends ChatFields {
    id: string;
    roomId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: ChatFields = {
    title: 'New Chat',
    chatNote: '',
    lorebooks: { refs: {}, folders: {} },
    personas: { refs: {}, folders: {} }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ChatRecord): ChatFields {
    return deepMerge(defaultFields, record.data as DeepPartial<ChatFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class ChatService {
    static async listByRoom(roomId: string): Promise<Chat[]> {
        await buffer.flushTable('chats');
        const { userId } = getActiveSession();
        const records = await localDB.getByIndex<ChatRecord>(
            'chats',
            'roomId',
            roomId,
            Number.MAX_SAFE_INTEGER
        );

        return records
            .filter((record) => record.userId === userId)
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                roomId: record.roomId
            }));
    }

    static async get(id: string): Promise<Chat | null> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || record.userId !== userId) return null;

        return {
            ...parseFields(record),
            id: record.id,
            roomId: record.roomId
        };
    }

    static async create(roomId: string, fields: DeepPartial<ChatFields> = {}): Promise<Chat> {
        const resolved: ChatFields = deepMerge(defaultFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const record: ChatRecord = {
                id,
                userId,
                roomId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ChatRecord>('chats', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create chat', error);
        }

        return { ...resolved, id, roomId };
    }

    static async update(id: string, changes: DeepPartial<ChatFields>): Promise<Chat> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        try {
            const current = parseFields(record);
            const updated: ChatFields = deepMerge(current, changes);

            buffer.update<ChatRecord>({
                tableName: 'chats',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id, roomId: record.roomId };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update chat', error);
        }
    }

    /** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
    static async delete(id: string): Promise<void> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Chat not found: ${id}`);
        }

        try {
            await Promise.all([
                buffer.flushTable('chats'),
                buffer.flushTable('messages'),
                buffer.flushTable('tool_calls'),
                buffer.flushTable('translations'),
                buffer.flushTable('lorebooks'),
                buffer.flushTable('scripts')
            ]);

            buffer.drop('chats', id);
            await localDB.transaction(
                ['lorebooks', 'scripts', 'messages', 'chats', 'tool_calls', 'translations'],
                'rw',
                async () => {
                    const results = await Promise.allSettled([
                        localDB.softDeleteByIndex('lorebooks', 'ownerId', id),
                        localDB.softDeleteByIndex('scripts', 'ownerId', id),
                        localDB.softDeleteByIndex('messages', 'chatId', id),
                        localDB.softDeleteByIndex('tool_calls', 'chatId', id),
                        localDB.softDeleteByIndex('translations', 'chatId', id),
                        localDB.softDeleteRecord('chats', id)
                    ]);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete chat', error);
        }
    }
}
