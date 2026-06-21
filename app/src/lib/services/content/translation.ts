import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type TranslationRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

export interface TranslationFields {
    targetLang: string;
    text: string;
    methodKey?: string;
    sourceHash?: string;
}

export interface Translation extends TranslationFields {
    id: string;
    chatId: string;
    messageId: string;
}

const defaultTranslationFields: TranslationFields = {
    targetLang: '',
    text: ''
};

function parseFields(record: TranslationRecord): TranslationFields {
    return deepMerge(defaultTranslationFields, record.data as DeepPartial<TranslationFields>);
}

export class TranslationService {
    static async listByMessage(messageId: string): Promise<Translation[]> {
        await buffer.flushTable('translations');
        const records = await localDB.getByIndex<TranslationRecord>(
            'translations',
            'messageId',
            messageId,
            Number.MAX_SAFE_INTEGER
        );
        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                chatId: record.chatId,
                messageId: record.messageId
            }));
    }

    static async get(id: string): Promise<Translation | null> {
        const record = await buffer.get<TranslationRecord>('translations', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            chatId: record.chatId,
            messageId: record.messageId
        };
    }

    static async create(
        chatId: string,
        messageId: string,
        fields: DeepPartial<TranslationFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<Translation> {
        const resolved: TranslationFields = deepMerge(defaultTranslationFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: TranslationRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                chatId,
                messageId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<TranslationRecord>('translations', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create translation', error);
        }

        return { ...resolved, id, chatId, messageId };
    }

    static async update(id: string, changes: DeepPartial<TranslationFields>): Promise<Translation> {
        const record = await buffer.get<TranslationRecord>('translations', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Translation not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: TranslationFields = deepMerge(current, changes);

            buffer.update<TranslationRecord>({
                tableName: 'translations',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                chatId: record.chatId,
                messageId: record.messageId
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update translation', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<TranslationRecord>('translations', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Translation not found: ${id}`);
        }

        try {
            buffer.drop('translations', id);
            await localDB.softDeleteRecord('translations', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete translation', error);
        }
    }
}
