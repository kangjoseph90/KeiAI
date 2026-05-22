import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type CharacterRecord, type DataScopeType } from '$lib/adapters/db';
import type { OrderedRef, ResourceRef, AssetRef, EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import { AssetService } from '../asset';

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
    backgroundHTML: string;
    messageCSS: string;
    greetings: Record<string, Greeting>;
    defaultVariables: Record<string, string>;
    allowLowLevel: boolean;
}

export interface CharacterRefs {
    avatarAssetId?: string;
    modules: EntityListConfig<ResourceRef>;
    lorebooks: EntityListConfig;
    scripts: EntityListConfig;
    charjs: EntityListConfig;
    assets: EntityListConfig<AssetRef>;
}

export interface CharacterFields extends CharacterContent, CharacterRefs {}

export interface Character extends CharacterFields {
    id: string;
    scopeType: DataScopeType;
    scopeId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: CharacterFields = {
    name: 'New Character',
    description: '',
    characterNote: '',
    backgroundHTML: '',
    messageCSS: '',
    greetings: {},
    defaultVariables: {},
    allowLowLevel: false,
    modules: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    scripts: { refs: {}, folders: {} },
    charjs: { refs: {}, folders: {} },
    assets: { refs: {}, folders: {} }
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: CharacterRecord): CharacterFields {
    return deepMerge(defaultFields, record.data as DeepPartial<CharacterFields>);
}

// ─── Service ─────────────────────────────────────────────────────────

export class CharacterService {
    static async list(scopeType: DataScopeType = 'user'): Promise<Character[]> {
        await buffer.flushTable('characters');
        const records = await localDB.getAll<CharacterRecord>(
            'characters',
            getSessionScope(scopeType)
        );
        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        }));
    }

    static async get(id: string): Promise<Character | null> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    static async create(
        fields: DeepPartial<CharacterFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<Character> {
        const resolved: CharacterFields = deepMerge(defaultFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const record: CharacterRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
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

        return { ...resolved, id, scopeType: scope.scopeType, scopeId: scope.scopeId };
    }

    static async update(id: string, changes: DeepPartial<CharacterFields>): Promise<Character> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
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

            return {
                ...updated,
                id: record.id,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
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
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Character not found: ${id}`);
        }

        const fields = parseFields(record);
        const assetIds: string[] = [];
        if (fields.avatarAssetId) assetIds.push(fields.avatarAssetId);
        assetIds.push(...Object.keys(fields.assets.refs));

        try {
            await Promise.all([
                buffer.flushTable('characters'),
                buffer.flushTable('lorebooks'),
                buffer.flushTable('scripts'),
                buffer.flushTable('charjs')
            ]);

            buffer.drop('characters', id);
            await localDB.transaction(
                ['lorebooks', 'scripts', 'characters', 'charjs'],
                'rw',
                async () => {
                    const deletePromises: Promise<void>[] = [
                        localDB.softDeleteByIndex('lorebooks', 'ownerId', id),
                        localDB.softDeleteByIndex('scripts', 'ownerId', id),
                        localDB.softDeleteByIndex('charjs', 'ownerId', id),
                        localDB.softDeleteRecord('characters', id)
                    ];

                    const results = await Promise.allSettled(deletePromises);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );

            await Promise.allSettled(assetIds.map((assetId) => AssetService.delete(assetId)));
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
