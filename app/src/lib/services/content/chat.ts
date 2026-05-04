import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../user';
import { localDB, type ChatRecord } from '$lib/adapters/db';
import type { FolderDef, OrderedRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ChatContent {
    title: string;
    systemPromptOverride?: string;
    defaultVariables?: Record<string, string>;
}

export interface ChatRefs {
    lastMessageId?: string;
    lorebookRefs?: OrderedRef[];
    folders?: {
        lorebooks?: FolderDef[];
    };
}

export interface ChatFields extends ChatContent, ChatRefs {}

export interface Chat extends ChatFields {
    id: string;
    characterId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: ChatFields = {
    title: 'New Chat'
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ChatRecord): ChatFields {
    return deepMerge(defaultFields, record.data as DeepPartial<ChatFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class ChatService {
    static async listByCharacter(characterId: string): Promise<Chat[]> {
        await writeQueue.flushTable('chats');
        const records = await localDB.getByIndex<ChatRecord>(
            'chats',
            'characterId',
            characterId,
            Number.MAX_SAFE_INTEGER
        );

        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            characterId: record.characterId
        }));
    }

    static async get(id: string): Promise<Chat | null> {
        const cached = writeQueue.peek<ChatRecord>('chats', id);
        if (cached) {
            if (cached.isDeleted) return null;
            return {
                ...parseFields(cached),
                id: cached.id,
                characterId: cached.characterId
            };
        }

        const record = await localDB.getRecord<ChatRecord>('chats', id);
        if (!record || record.isDeleted) return null;

        return {
            ...parseFields(record),
            id: record.id,
            characterId: record.characterId
        };
    }

    static async create(characterId: string, fields: DeepPartial<ChatFields> = {}): Promise<Chat> {
        const resolved: ChatFields = deepMerge(defaultFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const record: ChatRecord = {
                id,
                userId,
                characterId,
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

        return { ...resolved, id, characterId };
    }

    static async update(id: string, changes: DeepPartial<ChatFields>): Promise<Chat> {
        const cached = writeQueue.peek<ChatRecord>('chats', id);
        const record = cached ?? (await localDB.getRecord<ChatRecord>('chats', id));
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        try {
            const current = parseFields(record);
            const updated: ChatFields = deepMerge(current, changes);

            writeQueue.update<ChatRecord>({
                tableName: 'chats',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id, characterId: record.characterId };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update chat', error);
        }
    }

    /** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
    static async delete(id: string): Promise<void> {
        try {
            await Promise.all([
                writeQueue.flushTable('chats'),
                writeQueue.flushTable('messages'),
                writeQueue.flushTable('tool_calls'),
                writeQueue.flushTable('translations'),
                writeQueue.flushTable('lorebooks'),
                writeQueue.flushTable('scripts')
            ]);

            writeQueue.drop('chats', id);
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
