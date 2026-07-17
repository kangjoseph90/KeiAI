import { clock } from '$lib/utils/clock';
import { canAccessUserScope, getSessionScope } from '../session';
import { localDB, type ModuleRecord } from '$lib/adapters/db';
import type { AssetRef, EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';
import { AssetService, type AssetOwner } from '../asset';
import type { AssetEntries, AssetFields, AssetStatus } from '$lib/types/asset';
import type { TogglePanel } from '$lib/types/toggle';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ModuleRefs {
    lorebooks: EntityListConfig;
    scripts: EntityListConfig;
    charjs: EntityListConfig;
    assets: EntityListConfig<AssetRef>;
}

export interface ModuleContent {
    name: string;
    description: string;
    backgroundHTML: string;
    messageCSS: string;
    defaultVariables: Record<string, string>;
    toggles: TogglePanel;
    allowLowLevel: boolean;
}

export interface ModuleFields extends ModuleContent, ModuleRefs {}

export interface Module extends ModuleFields {
    id: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultModuleFields: ModuleFields = {
    name: 'New Module',
    description: '',
    backgroundHTML: '',
    messageCSS: '',
    defaultVariables: {},
    toggles: { refs: {}, folders: {} },
    allowLowLevel: false,
    lorebooks: { refs: {}, folders: {} },
    scripts: { refs: {}, folders: {} },
    charjs: { refs: {}, folders: {} },
    assets: { refs: {}, folders: {} }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ModuleRecord): ModuleFields {
    return deepMerge(defaultModuleFields, record.data as DeepPartial<ModuleFields>);
}

function assetOwner(record: ModuleRecord): AssetOwner {
    return {
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        ownerTable: 'modules',
        ownerId: record.id
    };
}

function collectAssetFields(fields: ModuleFields): AssetFields[] {
    return Object.values(fields.assets.refs).filter((asset): asset is AssetRef =>
        Boolean(asset?.hash)
    );
}

// ─── Service ──────────────────────────────────────────────────────────

export class ModuleService {
    static async list(): Promise<Module[]> {
        await buffer.flushTable('modules');
        const records = await localDB.getAll<ModuleRecord>('modules', getSessionScope('user'));

        return records.map((record) => ({
            ...parseFields(record),
            id: record.id
        }));
    }

    static async get(id: string): Promise<Module | null> {
        const record = await buffer.get<ModuleRecord>('modules', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id
        };
    }

    static async create(fields: DeepPartial<ModuleFields> = {}): Promise<Module> {
        const resolved: ModuleFields = deepMerge(defaultModuleFields, fields);

        const scope = getSessionScope('user');
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: ModuleRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                assetEntries: {},
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ModuleRecord>('modules', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create module', error);
        }

        return { ...resolved, id };
    }

    static async update(id: string, changes: DeepPartial<ModuleFields>): Promise<Module> {
        const record = await buffer.get<ModuleRecord>('modules', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: ModuleFields = deepMerge(current, changes);

            buffer.update<ModuleRecord>({
                tableName: 'modules',
                record: {
                    ...record,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update module', error);
        }
    }

    static async createAsset(
        id: string,
        asset: File | AssetFields,
        sortOrder: string
    ): Promise<Module> {
        const record = await buffer.get<ModuleRecord>('modules', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
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

        const updated: ModuleFields = {
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
            buffer.update<ModuleRecord>({
                tableName: 'modules',
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

        return { ...updated, id: record.id };
    }

    static async deleteAsset(id: string, assetId: string): Promise<Module> {
        const record = await buffer.get<ModuleRecord>('modules', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
        }

        const current = parseFields(record);
        const refToDelete = current.assets.refs[assetId];
        if (!refToDelete) {
            return { ...current, id: record.id };
        }

        const nextRefs = { ...current.assets.refs };
        delete nextRefs[assetId];

        const updated: ModuleFields = {
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

        buffer.update<ModuleRecord>({
            tableName: 'modules',
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

        return { ...updated, id: record.id };
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<ModuleRecord>('modules', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('modules');
            await Promise.all(
                (['modules', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );

            buffer.drop('modules', id);
            const result = await localDB.transaction(
                ['modules', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('modules', id);
                    await localDB.softDeleteRecord('modules', id);
                    return cascadeResult;
                }
            );

            await AssetService.deleteOwnerAssets(assetOwner(record));
            await cleanupCascadeAssets(result);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete module', error);
        }
    }
}
