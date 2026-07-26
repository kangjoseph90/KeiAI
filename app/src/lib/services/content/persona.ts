import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type PersonaRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import type { AssetRef, EntityListConfig } from '$lib/types/refs';
import { generateId } from '$lib/utils/id';
import { listItems } from '$lib/utils/ordering';
import { buffer } from './record_buffer';
import { AssetService, type AssetOwner } from '../asset';
import type { AssetEntries, AssetFields, AssetStatus } from '$lib/types/asset';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaContent {
    name: string;
    description: string;
}

export interface PersonaRefs {
    avatar?: AssetFields;
    assets: EntityListConfig<AssetRef>;
}

export interface PersonaFields extends PersonaContent, PersonaRefs {}

export interface Persona extends PersonaFields {
    id: string;
    scopeType: DataScopeType;
    scopeId: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultPersonaFields: PersonaFields = {
    name: 'New Persona',
    description: '',
    assets: { refs: {}, folders: {} }
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: PersonaRecord): PersonaFields {
    return deepMerge(defaultPersonaFields, record.data as DeepPartial<PersonaFields>);
}

function assetOwner(record: PersonaRecord): AssetOwner {
    return {
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        ownerTable: 'personas',
        ownerId: record.id
    };
}

function collectAssetFields(fields: PersonaFields): AssetFields[] {
    return [fields.avatar, ...listItems(fields.assets)].filter((asset): asset is AssetFields =>
        Boolean(asset?.hash)
    );
}

// ─── Service ─────────────────────────────────────────────────────────

export class PersonaService {
    /** List all personas */
    static async list(scopeType: DataScopeType = 'user'): Promise<Persona[]> {
        await buffer.flushTable('personas');
        const records = await localDB.getAll<PersonaRecord>('personas', getSessionScope(scopeType));

        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        }));
    }

    static async get(id: string): Promise<Persona | null> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    /** Create a persona */
    static async create(
        fields: DeepPartial<PersonaFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<Persona> {
        const resolved: PersonaFields = deepMerge(defaultPersonaFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: PersonaRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                assetEntries: {},
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<PersonaRecord>('personas', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create persona', error);
        }

        return { ...resolved, id, scopeType: scope.scopeType, scopeId: scope.scopeId };
    }

    /** Update a persona */
    static async update(id: string, changes: DeepPartial<PersonaFields>): Promise<Persona> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: PersonaFields = deepMerge(current, changes);

            buffer.update<PersonaRecord>({
                tableName: 'personas',
                record: {
                    ...record,
                    data: updated as unknown as Record<string, unknown>
                },
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update persona', error);
        }
    }

    static async createAsset(
        id: string,
        asset: File | AssetFields,
        sortOrder: string
    ): Promise<Persona> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
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

        const updated: PersonaFields = {
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
            buffer.update<PersonaRecord>({
                tableName: 'personas',
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

    static async deleteAsset(id: string, assetId: string): Promise<Persona> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
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

        const updated: PersonaFields = {
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

        buffer.update<PersonaRecord>({
            tableName: 'personas',
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

    static async updateAvatar(id: string, avatar: File | AssetFields): Promise<Persona> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
        }

        const current = parseFields(record);
        const owner = assetOwner(record);
        const oldAvatar = current.avatar;

        let fields: AssetFields;
        let status: AssetStatus;

        if (avatar instanceof File) {
            fields = await AssetService.write(avatar, owner, ['image']);
            status = 'local';
        } else {
            fields = avatar;
            status = 'remote';
        }

        const assetEntries = { ...record.assetEntries };
        if (!(fields.hash in assetEntries)) {
            assetEntries[fields.hash] = status;
        }

        const updated: PersonaFields = {
            ...current,
            avatar: fields
        };

        const nextFields = collectAssetFields(updated);
        const oldAvatarStillExists = oldAvatar
            ? nextFields.some((f) => f.hash === oldAvatar.hash)
            : true;

        if (oldAvatar && !oldAvatarStillExists) {
            delete assetEntries[oldAvatar.hash];
        }

        try {
            buffer.update<PersonaRecord>({
                tableName: 'personas',
                record: {
                    ...record,
                    assetEntries,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: { avatar: updated.avatar }
            });
        } catch (error) {
            if (avatar instanceof File) {
                await AssetService.delete({ ...owner, hash: fields.hash }).catch(() => undefined);
            }
            throw error;
        }

        if (oldAvatar && !oldAvatarStillExists) {
            await AssetService.delete({ ...owner, hash: oldAvatar.hash }).catch(() => undefined);
        }

        return { ...updated, id: record.id, scopeType: record.scopeType, scopeId: record.scopeId };
    }

    static async removeAvatar(id: string): Promise<Persona> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
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

        const updated: PersonaFields = {
            ...current,
            avatar: undefined
        };

        const nextFields = collectAssetFields(updated);
        const hashStillExists = nextFields.some((f) => f.hash === oldAvatar.hash);

        const assetEntries = { ...record.assetEntries };
        if (!hashStillExists) {
            delete assetEntries[oldAvatar.hash];
        }

        buffer.update<PersonaRecord>({
            tableName: 'personas',
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

    /** Delete a persona */
    static async delete(id: string): Promise<void> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
        }

        try {
            buffer.drop('personas', id);
            await localDB.softDeleteRecord('personas', id);
            await AssetService.deleteOwnerAssets(assetOwner(record));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete persona', error);
        }
    }
}
