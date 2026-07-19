import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type MessageRecord } from '$lib/adapters/db';
import { generateKeyBetween } from 'fractional-indexing';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';
import type { LLMRole } from '$lib/types/models/llm';
import type { AgentPart } from '$lib/workflow/agent/llm';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface MessageSwipeFields {
    parts: AgentPart[];
    variables?: Record<string, string>;
    speakerId?: string; // personaId if role is 'user', characterId if role is 'assistant'
    speakerName?: string;
    attachments?: string[]; // reference ids of chat.inlays
    translation?: MessageTranslation;
}

export interface MessageTranslation {
    sourceHash: string;
    text: string;
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
    scopeType: DataScopeType;
    scopeId: string;
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

function normalizeChanges(changes: DeepPartial<MessageFields>): DeepPartial<MessageFields> {
    if (!changes.swipes) return changes;

    const swipes = Object.fromEntries(
        Object.entries(changes.swipes).map(([id, swipe]) => [
            id,
            swipe && swipe.parts !== undefined ? { ...swipe, translation: undefined } : swipe
        ])
    );
    return { ...changes, swipes };
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
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            }));
    }

    static async getMessagesAfter(
        chatId: string,
        cursorSortOrder: string = '',
        limit = 50,
        offset = 0
    ): Promise<Message[]> {
        await buffer.flushTable('messages');

        const records = await localDB.getRecordsForward<MessageRecord>(
            'messages',
            '[chatId+sortOrder]',
            [chatId, cursorSortOrder],
            [chatId, '\uffff'],
            limit,
            offset
        );

        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            }));
    }

    static async get(id: string): Promise<Message | null> {
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            chatId: record.chatId,
            sortOrder: record.sortOrder,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    /** Create a message */
    static async create(
        chatId: string,
        fields: DeepPartial<MessageFields> = {},
        prevSortOrder?: string,
        scopeType: DataScopeType = 'user'
    ): Promise<Message> {
        const resolved: MessageFields = deepMerge(defaultMessageFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        const sortOrder = prevSortOrder
            ? generateKeyBetween(prevSortOrder, null)
            : generateKeyBetween(null, null);

        try {
            const newRecord: MessageRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
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

        return {
            ...resolved,
            id,
            chatId,
            sortOrder,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId
        };
    }

    /** Update a message */
    static async update(id: string, changes: DeepPartial<MessageFields>): Promise<Message> {
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const normalized = normalizeChanges(changes);
            const updated: MessageFields = deepMerge(current, normalized);

            buffer.update<MessageRecord>({
                tableName: 'messages',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: normalized as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                chatId: record.chatId,
                sortOrder: record.sortOrder,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update message', error);
        }
    }

    /** Soft-delete a message */
    static async delete(id: string): Promise<void> {
        const record = await buffer.get<MessageRecord>('messages', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Message not found: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('messages');
            await Promise.all(
                (['messages', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );
            buffer.drop('messages', id);
            const result = await localDB.transaction(
                ['messages', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('messages', id);
                    await localDB.softDeleteRecord('messages', id);
                    return cascadeResult;
                }
            );

            await cleanupCascadeAssets(result);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete message', error);
        }
    }

    static async countByChat(chatId: string): Promise<number> {
        // create and delete bypasses the write queue - doesn't need to flush the queue
        return localDB.countByIndex('messages', 'chatId', chatId);
    }

    static async countByChatBefore(chatId: string, beforeSortOrder: string): Promise<number> {
        return localDB.countRecordsInRange(
            'messages',
            '[chatId+sortOrder]',
            [chatId, ''],
            [chatId, beforeSortOrder]
        );
    }
}
