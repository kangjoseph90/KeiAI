import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type CharacterRecord } from '$lib/adapters/db';
import type { OrderedRef, FolderDef, AssetRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ────────────────────────────────────────────────────

export interface CharacterContent {
    name: string;
    shortDescription: string;
    systemPrompt: string;
    greetingMessage: string;
    allowLowLevel: boolean;
}

export interface CharacterRefs {
    lastActiveChatId?: string;
    avatarAssetId?: string;
    chatRefs?: OrderedRef[];
    moduleRefs?: OrderedRef[];
    lorebookRefs?: OrderedRef[];
    scriptRefs?: OrderedRef[];
    charjsRefs?: OrderedRef[];
    folders?: {
        chats?: FolderDef[];
        modules?: FolderDef[];
        lorebooks?: FolderDef[];
        scripts?: FolderDef[];
        charjs?: FolderDef[];
    };
    assets?: AssetRef[];
}

export interface CharacterFields extends CharacterContent, CharacterRefs {}

export interface Character extends CharacterFields {
    id: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: CharacterFields = {
    name: 'New Character',
    shortDescription: '',
    systemPrompt: '',
    greetingMessage: '',
    allowLowLevel: false
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: CharacterRecord): Promise<CharacterFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt character', error);
        });
}

// ─── Service ─────────────────────────────────────────────────────────

export class CharacterService {
    static async list(): Promise<Character[]> {
        await encryptedWriteQueue.flushTable('characters');
        const { masterKey, userId } = getActiveSession();
        const records = await localDB.getAll<CharacterRecord>('characters', userId);
        return Promise.all(
            records.map(async (record) => {
                const fields = await decryptFields(masterKey, record);
                return { id: record.id, ...fields };
            })
        );
    }

    static async get(id: string): Promise<Character | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<CharacterFields>('characters', id);
        if (queued) {
            const record = await localDB.getRecord<CharacterRecord>('characters', id);
            if (!record || record.isDeleted) return null;
            return { id, ...deepMerge(defaultFields, queued) };
        }

        const record = await localDB.getRecord<CharacterRecord>('characters', id);
        if (!record || record.isDeleted) return null;

        const fields = await decryptFields(masterKey, record);
        return { id: record.id, ...fields };
    }

    static async create(fields: DeepPartial<CharacterFields> = {}): Promise<Character> {
        const resolved: CharacterFields = deepMerge(defaultFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const record: CharacterRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<CharacterRecord>('characters', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create character', error);
        }

        return { id, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<CharacterFields>): Promise<Character> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<CharacterFields>('characters', id);
        const record = await localDB.getRecord<CharacterRecord>('characters', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', 'Character not found');
        }

        try {
            const current = queued
                ? deepMerge(defaultFields, queued)
                : await decryptFields(masterKey, record);
            const updated: CharacterFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<CharacterFields, CharacterRecord>({
                tableName: 'characters',
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
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    encryptedData,
                    encryptedDataIV
                })
            });

            return { id, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update character', error);
        }
    }

    /** Update content fields only — safe entry point for store layer */
    static async updateContent(
        id: string,
        changes: DeepPartial<CharacterContent>
    ): Promise<Character> {
        return this.update(id, changes);
    }

    static async delete(id: string): Promise<void> {
        try {
            await Promise.all([
                encryptedWriteQueue.flushTable('characters'),
                encryptedWriteQueue.flushTable('chats'),
                encryptedWriteQueue.flushTable('messages'),
                encryptedWriteQueue.flushTable('toolCalls'),
                encryptedWriteQueue.flushTable('lorebooks'),
                encryptedWriteQueue.flushTable('scripts'),
                encryptedWriteQueue.flushTable('charjs')
            ]);

            encryptedWriteQueue.drop('characters', id);
            await localDB.transaction(
                ['chats', 'lorebooks', 'scripts', 'messages', 'toolCalls', 'characters', 'charjs'],
                'rw',
                async () => {
                    const chatIds = (
                        await localDB.getByIndex(
                            'chats',
                            'characterId',
                            id,
                            Number.MAX_SAFE_INTEGER
                        )
                    ).map((c) => c.id);

                    const deletePromises: Promise<void>[] = [];
                    for (const chatId of chatIds) {
                        deletePromises.push(
                            localDB.softDeleteByIndex('messages', 'chatId', chatId),
                            localDB.softDeleteByIndex('toolCalls', 'chatId', chatId),
                            localDB.softDeleteByIndex('lorebooks', 'ownerId', chatId),
                            localDB.softDeleteByIndex('scripts', 'ownerId', chatId),
                            localDB.softDeleteByIndex('charjs', 'ownerId', chatId)
                        );
                    }
                    deletePromises.push(
                        localDB.softDeleteByIndex('chats', 'characterId', id),
                        localDB.softDeleteByIndex('lorebooks', 'ownerId', id),
                        localDB.softDeleteByIndex('scripts', 'ownerId', id),
                        localDB.softDeleteByIndex('charjs', 'ownerId', id),
                        localDB.softDeleteRecord('characters', id)
                    );

                    await Promise.all(deletePromises);
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete character', error);
        }
    }
}
