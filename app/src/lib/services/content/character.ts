import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../user';
import { localDB, type CharacterRecord } from '$lib/adapters/db';
import type { OrderedRef, ResourceRef, FolderDef, AssetRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

// ─── Domain Types ────────────────────────────────────────────────────

export interface Greeting {
    id: string;
    content: string;
    createdAt: number;
}

export interface CharacterContent {
    name: string;
    description: string;
    characterNote: string;
    greetings: Record<string, Greeting>;
    defaultVariables?: Record<string, string>;
    allowLowLevel: boolean;
}

export interface CharacterRefs {
    lastActiveChatId?: string;
    avatarAssetId?: string;
    chatRefs?: OrderedRef[];
    moduleRefs?: ResourceRef[];
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
    description: '',
    characterNote: '',
    greetings: {},
    allowLowLevel: false
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: CharacterRecord): CharacterFields {
    return deepMerge(defaultFields, record.data as DeepPartial<CharacterFields>);
}

// ─── Service ─────────────────────────────────────────────────────────

export class CharacterService {
    static async list(): Promise<Character[]> {
        await buffer.flushTable('characters');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<CharacterRecord>('characters', userId);
        return records.map((record) => ({ ...parseFields(record), id: record.id }));
    }

    static async get(id: string): Promise<Character | null> {
        const { userId } = getActiveSession();
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || record.userId !== userId) return null;

        return { ...parseFields(record), id: record.id };
    }

    static async create(fields: DeepPartial<CharacterFields> = {}): Promise<Character> {
        const resolved: CharacterFields = deepMerge(defaultFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const record: CharacterRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<CharacterRecord>('characters', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create character', error);
        }

        return { ...resolved, id };
    }

    static async update(id: string, changes: DeepPartial<CharacterFields>): Promise<Character> {
        const { userId } = getActiveSession();
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', 'Character not found');
        }

        try {
            const current = parseFields(record);
            const updated: CharacterFields = deepMerge(current, changes);

            buffer.update<CharacterRecord>({
                tableName: 'characters',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id };
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
        const { userId } = getActiveSession();
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Character not found: ${id}`);
        }

        try {
            await Promise.all([
                buffer.flushTable('characters'),
                buffer.flushTable('chats'),
                buffer.flushTable('messages'),
                buffer.flushTable('tool_calls'),
                buffer.flushTable('translations'),
                buffer.flushTable('lorebooks'),
                buffer.flushTable('scripts'),
                buffer.flushTable('charjs')
            ]);

            buffer.drop('characters', id);
            await localDB.transaction(
                [
                    'chats',
                    'lorebooks',
                    'scripts',
                    'messages',
                    'tool_calls',
                    'translations',
                    'characters',
                    'charjs'
                ],
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
                            localDB.softDeleteByIndex('tool_calls', 'chatId', chatId),
                            localDB.softDeleteByIndex('translations', 'chatId', chatId),
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

                    const results = await Promise.allSettled(deletePromises);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete character', error);
        }
    }

    // ─── Greeting CRUD ───────────────────────────────────────────────

    static async createGreeting(
        characterId: string,
        content: string
    ): Promise<{ greetingId: string; character: Character }> {
        const greetingId = generateId();
        const updatedCharacter = await this.update(characterId, {
            greetings: {
                [greetingId]: {
                    id: greetingId,
                    content: content,
                    createdAt: clock.now()
                }
            }
        });

        return { greetingId, character: updatedCharacter };
    }

    static async updateGreeting(
        characterId: string,
        greetingId: string,
        content: string
    ): Promise<Character> {
        return this.update(characterId, {
            greetings: {
                [greetingId]: { content }
            }
        });
    }

    static async deleteGreeting(characterId: string, greetingId: string): Promise<Character> {
        return this.update(characterId, {
            greetings: { [greetingId]: undefined }
        });
    }
}
