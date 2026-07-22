import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type CharacterRecord, type DataScopeType } from '$lib/adapters/db';
import type { EntityListConfig, AssetRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { listItems } from '$lib/utils/ordering';
import { buffer } from './record_buffer';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';
import { AssetService, type AssetOwner } from '../asset';
import type { AssetEntries, AssetFields, AssetStatus } from '$lib/types/asset';
import {
    defaultLorebookFields,
    defaultScriptFields,
    defaultCharJSFields,
    hydrateOwnedItems,
    type Lorebook,
    type Script,
    type CharJS
} from './resource';

// ─── Domain Types ────────────────────────────────────────────────────

export interface Greeting {
    id: string;
    content: string;
    sortOrder: string;
}

export interface CharacterContent {
    name: string;
    description: string;
    characterNote: string;
    backgroundHTML: string;
    messageCSS: string;
    greetings: Record<string, Greeting>;
    defaultVariables: Record<string, string>;
    lorebooks: EntityListConfig<Lorebook>;
    scripts: EntityListConfig<Script>;
    charjs: EntityListConfig<CharJS>;
    allowLowLevel: boolean;
}

export interface CharacterRefs {
    avatar?: AssetFields;
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
    lorebooks: { refs: {}, folders: {} },
    scripts: { refs: {}, folders: {} },
    charjs: { refs: {}, folders: {} },
    assets: { refs: {}, folders: {} }
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: CharacterRecord): CharacterFields {
    const fields = deepMerge(defaultFields, record.data as DeepPartial<CharacterFields>);
    fields.lorebooks.refs = hydrateOwnedItems(fields.lorebooks.refs, defaultLorebookFields);
    fields.scripts.refs = hydrateOwnedItems(fields.scripts.refs, defaultScriptFields);
    fields.charjs.refs = hydrateOwnedItems(fields.charjs.refs, defaultCharJSFields);
    return fields;
}

function assetOwner(record: CharacterRecord): AssetOwner {
    return {
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        ownerTable: 'characters',
        ownerId: record.id
    };
}

function collectAssetFields(fields: CharacterFields): AssetFields[] {
    return [fields.avatar, ...listItems(fields.assets)].filter((asset): asset is AssetFields =>
        Boolean(asset?.hash)
    );
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

    static async createAsset(
        id: string,
        asset: File | AssetFields,
        sortOrder: string
    ): Promise<Character> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Character not found');
        }

        const current = parseFields(record);
        const owner = assetOwner(record);

        let fields: AssetFields;
        let status: AssetStatus;

        if (asset instanceof File) {
            fields = await AssetService.write(asset, owner);
            status = 'local';
        } else {
            fields = asset;
            status = 'remote';
        }

        const assetEntries = { ...record.assetEntries };
        if (!(fields.hash in assetEntries)) {
            assetEntries[fields.hash] = status;
        }

        const assetId = generateId();
        const newRef: AssetRef = {
            id: assetId,
            sortOrder,
            ...fields
        };

        const updated: CharacterFields = {
            ...current,
            assets: {
                ...current.assets,
                refs: {
                    ...current.assets.refs,
                    [assetId]: newRef
                }
            }
        };

        try {
            buffer.update<CharacterRecord>({
                tableName: 'characters',
                record: {
                    ...record,
                    assetEntries,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: { assets: { refs: { [assetId]: newRef } } }
            });
        } catch (error) {
            if (asset instanceof File) {
                await AssetService.delete({ ...owner, hash: fields.hash }).catch(() => undefined);
            }
            throw error;
        }

        return { ...updated, id: record.id, scopeType: record.scopeType, scopeId: record.scopeId };
    }

    static async deleteAsset(id: string, assetId: string): Promise<Character> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Character not found');
        }

        const current = parseFields(record);
        const refToDelete = current.assets.refs[assetId];
        if (!refToDelete) {
            return {
                ...current,
                id: record.id,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        }

        const nextRefs = { ...current.assets.refs };
        delete nextRefs[assetId];

        const updated: CharacterFields = {
            ...current,
            assets: {
                ...current.assets,
                refs: nextRefs
            }
        };

        const nextFields = collectAssetFields(updated);
        const hashStillExists = nextFields.some((f) => f.hash === refToDelete.hash);

        const assetEntries = { ...record.assetEntries };
        if (!hashStillExists) {
            delete assetEntries[refToDelete.hash];
        }

        buffer.update<CharacterRecord>({
            tableName: 'characters',
            record: {
                ...record,
                assetEntries,
                data: updated as unknown as Record<string, unknown>
            },
            patch: { assets: { refs: { [assetId]: undefined } } }
        });

        if (!hashStillExists) {
            await AssetService.delete({ ...assetOwner(record), hash: refToDelete.hash }).catch(
                () => undefined
            );
        }

        return { ...updated, id: record.id, scopeType: record.scopeType, scopeId: record.scopeId };
    }

    static async updateAvatar(id: string, file: File | AssetFields): Promise<Character> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Character not found: ${id}`);
        }

        const current = parseFields(record);
        const owner = assetOwner(record);
        const oldAvatar = current.avatar;

        let written: AssetFields;
        let status: AssetStatus;

        if (file instanceof File) {
            written = await AssetService.write(file, owner);
            status = 'local';
        } else {
            written = file;
            status = 'remote';
        }

        const assetEntries = { ...record.assetEntries };
        if (!(written.hash in assetEntries)) {
            assetEntries[written.hash] = status;
        }

        const updated: CharacterFields = {
            ...current,
            avatar: written
        };

        const nextFields = collectAssetFields(updated);
        const oldAvatarStillExists = oldAvatar
            ? nextFields.some((f) => f.hash === oldAvatar.hash)
            : true;

        if (oldAvatar && !oldAvatarStillExists) {
            delete assetEntries[oldAvatar.hash];
        }

        try {
            buffer.update<CharacterRecord>({
                tableName: 'characters',
                record: {
                    ...record,
                    assetEntries,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: { avatar: updated.avatar }
            });
        } catch (error) {
            if (file instanceof File) {
                await AssetService.delete({ ...owner, hash: written.hash }).catch(() => undefined);
            }
            throw error;
        }

        if (oldAvatar && !oldAvatarStillExists) {
            await AssetService.delete({ ...owner, hash: oldAvatar.hash }).catch(() => undefined);
        }

        return { ...updated, id: record.id, scopeType: record.scopeType, scopeId: record.scopeId };
    }

    static async removeAvatar(id: string): Promise<Character> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Character not found: ${id}`);
        }

        const current = parseFields(record);
        const oldAvatar = current.avatar;
        if (!oldAvatar) {
            return {
                ...current,
                id: record.id,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        }

        const updated: CharacterFields = {
            ...current,
            avatar: undefined
        };

        const nextFields = collectAssetFields(updated);
        const hashStillExists = nextFields.some((f) => f.hash === oldAvatar.hash);

        const assetEntries = { ...record.assetEntries };
        if (!hashStillExists) {
            delete assetEntries[oldAvatar.hash];
        }

        buffer.update<CharacterRecord>({
            tableName: 'characters',
            record: {
                ...record,
                assetEntries,
                data: updated as unknown as Record<string, unknown>
            },
            patch: { avatar: updated.avatar }
        });

        if (!hashStillExists) {
            await AssetService.delete({ ...assetOwner(record), hash: oldAvatar.hash }).catch(
                () => undefined
            );
        }

        return { ...updated, id: record.id, scopeType: record.scopeType, scopeId: record.scopeId };
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<CharacterRecord>('characters', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Character not found: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('characters');
            await Promise.all(
                (['characters', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );

            buffer.drop('characters', id);

            const result = await localDB.transaction(
                ['characters', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('characters', id);
                    await localDB.softDeleteRecord('characters', id);
                    return cascadeResult;
                }
            );

            await AssetService.deleteOwnerAssets(assetOwner(record));
            await cleanupCascadeAssets(result);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete character', error);
        }
    }
}
