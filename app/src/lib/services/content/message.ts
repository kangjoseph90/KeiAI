import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../user';
import { localDB, type MessageRecord } from '$lib/adapters/db';
import { generateKeyBetween } from 'fractional-indexing';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { ToolCallInfo } from './tool';
import { buffer } from './record_buffer';
import type { LLMRole } from '$lib/types/models/llm';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface MessageSwipeFields {
    content: string;
    thought?: string;
    toolCalls?: Record<string, ToolCallInfo>;
    variables?: Record<string, string>;
    speakerId?: string; // personaId if role is 'user', characterId if role is 'assistant'
    speakerName?: string;
}

/**
 * Swipe IDs are local to their parent message.
 *
 * A swipe must be addressed as (messageId, swipeId) outside the message JSON.
 * Do not use swipeId alone for cross-table lookups or deletes.
 */
export interface MessageSwipe extends MessageSwipeFields {
    id: string;
    createdAt: number;
}

export interface MessageFields {
    role: LLMRole;
    swipes: Record<string, MessageSwipe>;
    activeSwipeId: string;
}

export interface Message extends MessageFields {
    id: string;
    chatId: string;
    sortOrder: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultMessageFields: MessageFields = {
    role: 'user',
    swipes: {},
    activeSwipeId: ''
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: MessageRecord): MessageFields {
    return deepMerge(defaultMessageFields, record.data as DeepPartial<MessageFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class MessageService {
    /**
     * Cursor-based pagination for UI (loads older messages)
     * Returns messages sorted ascending (oldest first) within the batch
     */
    static async getMessagesBefore(
        chatId: string,
        cursorSortOrder: string = '\uffff',
        limit = 50,
        offset = 0
    ): Promise<Message[]> {
        await buffer.flushTable('messages');
        const { userId } = getActiveSession();
        const records = await localDB.getRecordsBackward<MessageRecord>(
            'messages',
            '[chatId+sortOrder]',
            [chatId, ''],
            [chatId, cursorSortOrder],
            limit,
            offset
        );

        // The results are in reverse order (newest to oldest), so we need to reverse
        // them again to get an oldest-to-newest ordering for the UI to prepend.
        records.reverse();

        return records
            .filter((record) => record.userId === userId)
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder
            }));
    }

    static async getMessagesAfter(
        chatId: string,
        cursorSortOrder: string = '',
        limit = 50,
        offset = 0
    ): Promise<Message[]> {
        await buffer.flushTable('messages');
        const { userId } = getActiveSession();

        const records = await localDB.getRecordsForward<MessageRecord>(
            'messages',
            '[chatId+sortOrder]',
            [chatId, cursorSortOrder],
            [chatId, '\uffff'],
            limit,
            offset
        );

        return records
            .filter((record) => record.userId === userId)
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder
            }));
    }

    static async get(id: string): Promise<Message | null> {
        const { userId } = getActiveSession();
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || record.userId !== userId) return null;

        return {
            ...parseFields(record),
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder
        };
    }

    /** Create a message */
    static async create(
        chatId: string,
        fields: DeepPartial<MessageFields> = {},
        prevSortOrder?: string
    ): Promise<Message> {
        const resolved: MessageFields = deepMerge(defaultMessageFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        const sortOrder = prevSortOrder
            ? generateKeyBetween(prevSortOrder, null)
            : generateKeyBetween(null, null);

        try {
            const newRecord: MessageRecord = {
                id,
                userId,
                chatId,
                sortOrder,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<MessageRecord>('messages', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create message', error);
        }

        return { ...resolved, id, chatId, sortOrder };
    }

    /** Update a message */
    static async update(id: string, changes: DeepPartial<MessageFields>): Promise<Message> {
        const { userId } = getActiveSession();
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: MessageFields = deepMerge(current, changes);

            buffer.update<MessageRecord>({
                tableName: 'messages',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update message', error);
        }
    }

    /** Soft-delete a message */
    static async delete(id: string): Promise<void> {
        const { userId } = getActiveSession();
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            await Promise.all([
                buffer.flushTable('messages'),
                buffer.flushTable('tool_calls'),
                buffer.flushTable('translations')
            ]);
            buffer.drop('messages', id);
            await localDB.transaction(
                ['messages', 'tool_calls', 'translations'],
                'rw',
                async () => {
                    const results = await Promise.allSettled([
                        localDB.softDeleteByIndex('tool_calls', 'messageId', id),
                        localDB.softDeleteByIndex('translations', 'messageId', id),
                        localDB.softDeleteRecord('messages', id)
                    ]);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete message', error);
        }
    }

    static async createSwipe(
        messageId: string,
        fields: MessageSwipeFields
    ): Promise<{ swipeId: string; message: Message }> {
        const swipeId = generateId();
        const updatedMessage = await this.update(messageId, {
            swipes: {
                [swipeId]: {
                    ...fields,
                    id: swipeId,
                    createdAt: clock.now()
                }
            }
        });

        return { swipeId, message: updatedMessage };
    }

    static async updateSwipe(
        messageId: string,
        swipeId: string,
        changes: DeepPartial<MessageSwipe>
    ): Promise<Message> {
        return this.update(messageId, {
            swipes: {
                [swipeId]: changes
            }
        });
    }

    static async deleteSwipe(messageId: string, swipeId: string): Promise<Message> {
        const message = await this.get(messageId);
        if (!message) throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);

        const remainingIds = Object.keys(message.swipes).filter((id) => id !== swipeId);
        const nextActiveId =
            message.activeSwipeId === swipeId ? (remainingIds[0] ?? '') : message.activeSwipeId;

        // Cleanup associated data
        await Promise.all([buffer.flushTable('tool_calls'), buffer.flushTable('translations')]);
        await localDB.transaction(['tool_calls', 'translations'], 'rw', async () => {
            await Promise.all([
                localDB.softDeleteByCompoundIndex('tool_calls', '[messageId+swipeId]', [
                    messageId,
                    swipeId
                ]),
                localDB.softDeleteByCompoundIndex('translations', '[messageId+swipeId]', [
                    messageId,
                    swipeId
                ])
            ]);
        });

        return this.update(messageId, {
            swipes: { [swipeId]: undefined },
            activeSwipeId: nextActiveId
        });
    }

    static async countByChat(chatId: string): Promise<number> {
        // create and delete bypasses the write queue - doesn't need to flush the queue
        const { userId } = getActiveSession();
        const records = await localDB.getByIndex<MessageRecord>(
            'messages',
            'chatId',
            chatId,
            Number.MAX_SAFE_INTEGER
        );
        return records.filter((record) => record.userId === userId).length;
    }

    static async countByChatBefore(chatId: string, beforeSortOrder: string): Promise<number> {
        const { userId } = getActiveSession();
        const records = await localDB.getRecordsForward<MessageRecord>(
            'messages',
            '[chatId+sortOrder]',
            [chatId, ''],
            [chatId, beforeSortOrder],
            Number.MAX_SAFE_INTEGER
        );
        return records.filter((record) => record.userId === userId).length;
    }
}
