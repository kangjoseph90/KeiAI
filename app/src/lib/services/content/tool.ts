import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type ToolCallRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

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
    static async listByMessageSwipe(messageId: string, swipeId: string): Promise<ToolCall[]> {
        await buffer.flushTable('tool_calls');
        const records = await localDB.getByCompoundIndex<ToolCallRecord>(
            'tool_calls',
            '[messageId+swipeId]',
            [messageId, swipeId],
            Number.MAX_SAFE_INTEGER
        );
        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                messageId: record.messageId,
                swipeId: record.swipeId
            }));
    }

    static async get(id: string): Promise<ToolCall | null> {
        const record = await buffer.get<ToolCallRecord>('tool_calls', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            chatId: record.chatId,
            messageId: record.messageId,
            swipeId: record.swipeId
        };
    }

    static async create(
        chatId: string,
        messageId: string,
        swipeId: string,
        fields: DeepPartial<ToolCallFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<ToolCall> {
        const resolved: ToolCallFields = deepMerge(defaultToolCallFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: ToolCallRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
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

        return { ...resolved, id, chatId, messageId, swipeId };
    }

    static async update(id: string, changes: DeepPartial<ToolCallFields>): Promise<ToolCall> {
        const record = await buffer.get<ToolCallRecord>('tool_calls', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Tool call not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: ToolCallFields = deepMerge(current, changes);

            buffer.update<ToolCallRecord>({
                tableName: 'tool_calls',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                chatId: record.chatId,
                messageId: record.messageId,
                swipeId: record.swipeId
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update tool call', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<ToolCallRecord>('tool_calls', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Tool call not found: ${id}`);
        }

        try {
            buffer.drop('tool_calls', id);
            await localDB.softDeleteRecord('tool_calls', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete tool call', error);
        }
    }
}
