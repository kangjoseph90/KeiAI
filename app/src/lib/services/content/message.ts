import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../user';
import { localDB, type MessageRecord } from '$lib/adapters/db';
import { generateKeyBetween } from 'fractional-indexing';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { ToolCallInfo } from './tool';
import { writeQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface MessageSwipeFields {
    content: string;
    thought?: string;
    toolCalls?: Record<string, ToolCallInfo>;
    variables?: Record<string, string>;
    createdAt: number;
}

/**
 * Swipe IDs are local to their parent message.
 *
 * A swipe must be addressed as (messageId, swipeId) outside the message JSON.
 * Do not use swipeId alone for cross-table lookups or deletes.
 */
export interface MessageSwipe extends MessageSwipeFields {
    id: string;
}

export interface MessageFields {
    role: 'user' | 'char' | 'system';
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
        cursorSortOrder: string = '￿',
        limit = 50,
        offset = 0
    ): Promise<Message[]> {
        await writeQueue.flushTable('messages');
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

        return records.map((record) => ({
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
        await writeQueue.flushTable('messages');

        const records = await localDB.getRecordsForward<MessageRecord>(
            'messages',
            '[chatId+sortOrder]',
            [chatId, cursorSortOrder],
            [chatId, '￿'],
            limit,
            offset
        );

        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder
        }));
    }

    static async get(id: string): Promise<Message | null> {
        const cached = writeQueue.peek<MessageRecord>('messages', id);
        if (cached) {
            if (cached.isDeleted) return null;
            return {
                ...parseFields(cached),
                id: cached.id,
                chatId: cached.chatId,
                sortOrder: cached.sortOrder
            };
        }

        const record = await localDB.getRecord<MessageRecord>('messages', id);
        if (!record || record.isDeleted) return null;

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
        providedSortOrder?: string
    ): Promise<Message> {
        const resolved: MessageFields = deepMerge(defaultMessageFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        let sortOrder = providedSortOrder;
        if (!sortOrder) {
            const lastRecords = await localDB.getRecordsBackward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                [chatId, ''],
                [chatId, '￿'],
                1
            );
            if (lastRecords.length > 0) {
                sortOrder = generateKeyBetween(lastRecords[0].sortOrder, null);
            } else {
                sortOrder = generateKeyBetween(null, null);
            }
        }

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
        const cached = writeQueue.peek<MessageRecord>('messages', id);
        const record = cached ?? (await localDB.getRecord<MessageRecord>('messages', id));
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: MessageFields = deepMerge(current, changes);

            writeQueue.update<MessageRecord>({
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
        try {
            await Promise.all([
                writeQueue.flushTable('messages'),
                writeQueue.flushTable('tool_calls'),
                writeQueue.flushTable('translations')
            ]);
            writeQueue.drop('messages', id);
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
        const message = await this.get(messageId);
        if (!message) {
            throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
        }

        const swipeId = generateId();
        const swipe: MessageSwipe = {
            ...fields,
            id: swipeId,
            createdAt: fields.createdAt ?? clock.now()
        };

        const updatedMessage = await this.update(messageId, {
            role: message.role,
            swipes: {
                ...message.swipes,
                [swipeId]: swipe
            },
            activeSwipeId: message.activeSwipeId
        });

        return { swipeId, message: updatedMessage };
    }

    static async updateSwipe(
        messageId: string,
        swipeId: string,
        changes: DeepPartial<MessageSwipe>
    ): Promise<Message> {
        const message = await this.get(messageId);
        if (!message) {
            throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
        }

        const swipe = message.swipes[swipeId];
        if (!swipe) {
            throw new AppError('NOT_FOUND', `Swipe not found: ${swipeId}`);
        }

        const updatedSwipe = deepMerge(swipe, changes);
        return await this.update(messageId, {
            role: message.role,
            swipes: {
                ...message.swipes,
                [swipeId]: updatedSwipe
            },
            activeSwipeId: message.activeSwipeId
        });
    }

    static async deleteSwipe(messageId: string, swipeId: string): Promise<Message> {
        await Promise.all([
            writeQueue.flushTable('messages'),
            writeQueue.flushTable('tool_calls'),
            writeQueue.flushTable('translations')
        ]);

        const message = await this.get(messageId);
        if (!message) {
            throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
        }

        if (!message.swipes[swipeId]) {
            throw new AppError('NOT_FOUND', `Swipe not found: ${swipeId}`);
        }

        const record = await localDB.getRecord<MessageRecord>('messages', messageId);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
        }

        const nextSwipes = { ...message.swipes };
        delete nextSwipes[swipeId];

        let nextActiveId = message.activeSwipeId;
        if (nextActiveId === swipeId) {
            const remainingIds = Object.keys(nextSwipes);
            nextActiveId = remainingIds.length > 0 ? remainingIds[0] : '';
        }

        const nextFields: MessageFields = {
            role: message.role,
            swipes: nextSwipes,
            activeSwipeId: nextActiveId
        };

        try {
            writeQueue.drop('messages', messageId);

            await localDB.transaction(
                ['messages', 'tool_calls', 'translations'],
                'rw',
                async () => {
                    const results = await Promise.allSettled([
                        localDB.softDeleteByCompoundIndex('tool_calls', '[messageId+swipeId]', [
                            messageId,
                            swipeId
                        ]),
                        localDB.softDeleteByCompoundIndex('translations', '[messageId+swipeId]', [
                            messageId,
                            swipeId
                        ]),
                        localDB.putRecord<MessageRecord>('messages', {
                            ...record,
                            updatedAt: clock.now(),
                            data: nextFields as unknown as Record<string, unknown>
                        })
                    ]);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );

            return {
                ...nextFields,
                id: messageId,
                chatId: record.chatId,
                sortOrder: record.sortOrder
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete message swipe', error);
        }
    }

    static async countByChat(chatId: string): Promise<number> {
        // create and delete bypasses the write queue - doesn't need to flush the queue
        return await localDB.countByIndex('messages', 'chatId', chatId);
    }

    static async countByChatBefore(chatId: string, beforeSortOrder: string): Promise<number> {
        return await localDB.countRecordsInRange(
            'messages',
            '[chatId+sortOrder]',
            [chatId, ''],
            [chatId, beforeSortOrder]
        );
    }
}
