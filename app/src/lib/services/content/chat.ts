import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ChatRecord } from '$lib/adapters/db';
import type { FolderDef, OrderedRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ChatContent {
    title: string;
    systemPromptOverride?: string;
    defaultVariables?: Record<string, string>;
}

export interface ChatRefs {
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

function decryptFields(masterKey: CryptoKey, record: ChatRecord): Promise<ChatFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt chat', error);
        });
}

// ─── Service ──────────────────────────────────────────────────────────

export class ChatService {
    static async listByCharacter(characterId: string): Promise<Chat[]> {
        await encryptedWriteQueue.flushTable('chats');
        const { masterKey } = getActiveSession();
        const records = await localDB.getByIndex<ChatRecord>(
            'chats',
            'characterId',
            characterId,
            Number.MAX_SAFE_INTEGER
        );

        return Promise.all(
            records.map(async (record) => {
                const fields = await decryptFields(masterKey, record);
                return {
                    id: record.id,
                    characterId: record.characterId,
                    ...fields
                };
            })
        );
    }

    static async get(id: string): Promise<Chat | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ChatFields>('chats', id);
        if (queued) {
            const record = await localDB.getRecord<ChatRecord>('chats', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                characterId: record.characterId,
                ...deepMerge(defaultFields, queued)
            };
        }

        const record = await localDB.getRecord<ChatRecord>('chats', id);
        if (!record || record.isDeleted) return null;

        const fields = await decryptFields(masterKey, record);
        return {
            id: record.id,
            characterId: record.characterId,
            ...fields
        };
    }

    static async create(characterId: string, fields: DeepPartial<ChatFields> = {}): Promise<Chat> {
        const resolved: ChatFields = deepMerge(defaultFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const record: ChatRecord = {
                id,
                userId,
                characterId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<ChatRecord>('chats', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create chat', error);
        }

        return { id, characterId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ChatFields>): Promise<Chat> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ChatFields>('chats', id);
        const record = await localDB.getRecord<ChatRecord>('chats', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        try {
            const current = queued
                ? deepMerge(defaultFields, queued)
                : await decryptFields(masterKey, record);
            const updated: ChatFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<ChatFields, ChatRecord>({
                tableName: 'chats',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({
                    id: recordId,
                    userId: recordUserId,
                    createdAt,
                    updatedAt,
                    encryptedData,
                    encryptedDataIV
                }) => ({
                    id: recordId,
                    userId: recordUserId,
                    characterId: record.characterId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    encryptedData,
                    encryptedDataIV
                })
            });

            return { id, characterId: record.characterId, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update chat', error);
        }
    }

    /** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
    static async delete(id: string): Promise<void> {
        try {
            await Promise.all([
                encryptedWriteQueue.flushTable('chats'),
                encryptedWriteQueue.flushTable('messages'),
                encryptedWriteQueue.flushTable('toolCalls'),
                encryptedWriteQueue.flushTable('lorebooks'),
                encryptedWriteQueue.flushTable('scripts')
            ]);

            encryptedWriteQueue.drop('chats', id);
            await localDB.transaction(
                ['lorebooks', 'scripts', 'messages', 'chats', 'toolCalls'],
                'rw',
                async () => {
                    const results = await Promise.allSettled([
                        localDB.softDeleteByIndex('lorebooks', 'ownerId', id),
                        localDB.softDeleteByIndex('scripts', 'ownerId', id),
                        localDB.softDeleteByIndex('messages', 'chatId', id),
                        localDB.softDeleteByIndex('toolCalls', 'chatId', id),
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
