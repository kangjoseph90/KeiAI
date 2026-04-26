import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
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
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder,
            ...parseFields(record)
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
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<Message | null> {
        const queued = writeQueue.peek<MessageFields>('messages', id);
        if (queued) {
            const record = await localDB.getRecord<MessageRecord>('messages', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                chatId: record.chatId,
                sortOrder: record.sortOrder,
                ...deepMerge(defaultMessageFields, queued)
            };
        }

        const record = await localDB.getRecord<MessageRecord>('messages', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder,
            ...parseFields(record)
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

        return { id, chatId, sortOrder, ...resolved };
    }

    /** Update a message */
    static async update(id: string, changes: DeepPartial<MessageFields>): Promise<Message> {
        const queued = writeQueue.peek<MessageFields>('messages', id);
        const record = await localDB.getRecord<MessageRecord>('messages', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultMessageFields, queued) : parseFields(record);
            const updated: MessageFields = deepMerge(current, changes);

            writeQueue.upsert<MessageFields, MessageRecord>({
                tableName: 'messages',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({ id: recordId, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id: recordId,
                    userId: recordUserId,
                    chatId: record.chatId,
                    sortOrder: record.sortOrder,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });

            return { id, chatId: record.chatId, sortOrder: record.sortOrder, ...updated };
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
                        localDB.softDeleteByIndex('tool_calls', 'swipeId', swipeId),
                        localDB.softDeleteByIndex('translations', 'swipeId', swipeId),
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
                id: messageId,
                chatId: record.chatId,
                sortOrder: record.sortOrder,
                ...nextFields
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete message swipe', error);
        }
    }

    static async countByChat(chatId: string): Promise<number> {
        await writeQueue.flushTable('messages');
        return await localDB.countByIndex('messages', 'chatId', chatId);
    }
}
