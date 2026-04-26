import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type TranslationRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

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
    swipeId: string;
}

const defaultTranslationFields: TranslationFields = {
    targetLang: '',
    text: ''
};

function parseFields(record: TranslationRecord): TranslationFields {
    return deepMerge(defaultTranslationFields, record.data as DeepPartial<TranslationFields>);
}

export class TranslationService {
    static async listBySwipe(swipeId: string): Promise<Translation[]> {
        await writeQueue.flushTable('translations');
        const records = await localDB.getByIndex<TranslationRecord>(
            'translations',
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

    static async get(id: string): Promise<Translation | null> {
        const queued = writeQueue.peek<TranslationFields>('translations', id);
        if (queued) {
            const record = await localDB.getRecord<TranslationRecord>('translations', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                chatId: record.chatId,
                messageId: record.messageId,
                swipeId: record.swipeId,
                ...deepMerge(defaultTranslationFields, queued)
            };
        }

        const record = await localDB.getRecord<TranslationRecord>('translations', id);
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
        fields: DeepPartial<TranslationFields> = {}
    ): Promise<Translation> {
        const resolved: TranslationFields = deepMerge(defaultTranslationFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: TranslationRecord = {
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
            await localDB.putRecord<TranslationRecord>('translations', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create translation', error);
        }

        return { id, chatId, messageId, swipeId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<TranslationFields>): Promise<Translation> {
        const queued = writeQueue.peek<TranslationFields>('translations', id);
        const record = await localDB.getRecord<TranslationRecord>('translations', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Translation not found: ${id}`);
        }

        try {
            const current = queued
                ? deepMerge(defaultTranslationFields, queued)
                : parseFields(record);
            const updated: TranslationFields = deepMerge(current, changes);

            writeQueue.upsert<TranslationFields, TranslationRecord>({
                tableName: 'translations',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update translation', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('translations', id);
            await localDB.softDeleteRecord('translations', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete translation', error);
        }
    }
}
