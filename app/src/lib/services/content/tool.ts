import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type ToolCallRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

export type ToolCallStatus = 'pending' | 'success' | 'rejected' | 'error';

// Lightweight tool call info stored on a message swipe.
export interface ToolCallInfo {
    id: string; // internal tool callid
    name: string; // tool name
    status: ToolCallStatus;
}

export type ToolCallRequest = {
    callId: string; // Call Id given by LLM provider
    name: string;
    args: Record<string, unknown>;
};

export type ToolCallResponse =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'audio'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };

export interface ToolCallFields {
    status: ToolCallStatus;
    call: ToolCallRequest;
    response?: {
        content: ToolCallResponse[];
        isError?: boolean;
    };
}

export interface ToolCall extends ToolCallFields {
    id: string; // internal id
    chatId: string;
    messageId: string;
    swipeId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultToolCallFields: ToolCallFields = {
    status: 'pending',
    call: {
        callId: '',
        name: '',
        args: {}
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ToolCallRecord): ToolCallFields {
    return deepMerge(defaultToolCallFields, record.data as DeepPartial<ToolCallFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class ToolCallService {
    /** List tool calls for a specific swipe */
    static async listBySwipe(swipeId: string): Promise<ToolCall[]> {
        await writeQueue.flushTable('tool_calls');
        const records = await localDB.getByIndex<ToolCallRecord>(
            'tool_calls',
            'swipeId',
            swipeId,
            Number.MAX_SAFE_INTEGER
        );
        return records.map((record) => ({
            id: record.id,
            chatId: record.chatId,
            messageId: record.messageId,
            swipeId: record.swipeId,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<ToolCall | null> {
        const queued = writeQueue.peek<ToolCallFields>('tool_calls', id);
        if (queued) {
            const record = await localDB.getRecord<ToolCallRecord>('tool_calls', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                chatId: record.chatId,
                messageId: record.messageId,
                swipeId: record.swipeId,
                ...deepMerge(defaultToolCallFields, queued)
            };
        }

        const record = await localDB.getRecord<ToolCallRecord>('tool_calls', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            chatId: record.chatId,
            messageId: record.messageId,
            swipeId: record.swipeId,
            ...parseFields(record)
        };
    }

    static async create(
        chatId: string,
        messageId: string,
        swipeId: string,
        fields: DeepPartial<ToolCallFields> = {}
    ): Promise<ToolCall> {
        const resolved: ToolCallFields = deepMerge(defaultToolCallFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: ToolCallRecord = {
                id,
                userId,
                chatId,
                messageId,
                swipeId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ToolCallRecord>('tool_calls', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create tool call', error);
        }

        return { id, chatId, messageId, swipeId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ToolCallFields>): Promise<ToolCall> {
        const queued = writeQueue.peek<ToolCallFields>('tool_calls', id);
        const record = await localDB.getRecord<ToolCallRecord>('tool_calls', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Tool call not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultToolCallFields, queued) : parseFields(record);
            const updated: ToolCallFields = deepMerge(current, changes);

            writeQueue.upsert<ToolCallFields, ToolCallRecord>({
                tableName: 'tool_calls',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({ id: recordId, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id: recordId,
                    userId: recordUserId,
                    chatId: record.chatId,
                    messageId: record.messageId,
                    swipeId: record.swipeId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });

            return {
                id,
                chatId: record.chatId,
                messageId: record.messageId,
                swipeId: record.swipeId,
                ...updated
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update tool call', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('tool_calls', id);
            await localDB.softDeleteRecord('tool_calls', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete tool call', error);
        }
    }
}
