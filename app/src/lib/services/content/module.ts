import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type ModuleRecord } from '$lib/adapters/db';
import type { AssetRef, FolderDef, OrderedRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ModuleRefs {
    lorebookRefs?: OrderedRef[];
    scriptRefs?: OrderedRef[];
    charjsRefs?: OrderedRef[];
    folders?: {
        lorebooks?: FolderDef[];
        scripts?: FolderDef[];
        charjs?: FolderDef[];
    };
    assets?: AssetRef[];
}

export interface ModuleContent {
    name: string;
    description: string;
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
    allowLowLevel: false
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ModuleRecord): ModuleFields {
    return deepMerge(defaultModuleFields, record.data as DeepPartial<ModuleFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class ModuleService {
    static async list(): Promise<Module[]> {
        await writeQueue.flushTable('modules');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<ModuleRecord>('modules', userId);

        return records.map((record) => ({
            id: record.id,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<Module | null> {
        const queued = writeQueue.peek<ModuleFields>('modules', id);
        if (queued) {
            const record = await localDB.getRecord<ModuleRecord>('modules', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ...deepMerge(defaultModuleFields, queued)
            };
        }

        const record = await localDB.getRecord<ModuleRecord>('modules', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            ...parseFields(record)
        };
    }

    static async create(fields: DeepPartial<ModuleFields> = {}): Promise<Module> {
        const resolved: ModuleFields = deepMerge(defaultModuleFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: ModuleRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ModuleRecord>('modules', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create module', error);
        }

        return { id, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ModuleFields>): Promise<Module> {
        const queued = writeQueue.peek<ModuleFields>('modules', id);
        const record = await localDB.getRecord<ModuleRecord>('modules', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultModuleFields, queued) : parseFields(record);
            const updated: ModuleFields = deepMerge(current, changes);

            writeQueue.upsert<ModuleFields, ModuleRecord>({
                tableName: 'modules',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({ id: recordId, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id: recordId,
                    userId: recordUserId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });

            return { id, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update module', error);
        }
    }

    /** Update content fields only — safe entry point for store layer */
    static async updateContent(id: string, changes: DeepPartial<ModuleContent>): Promise<Module> {
        return this.update(id, changes);
    }

    static async delete(id: string): Promise<void> {
        try {
            await Promise.all([
                writeQueue.flushTable('modules'),
                writeQueue.flushTable('lorebooks'),
                writeQueue.flushTable('scripts'),
                writeQueue.flushTable('charjs')
            ]);

            writeQueue.drop('modules', id);
            await localDB.transaction(
                ['lorebooks', 'scripts', 'charjs', 'modules'],
                'rw',
                async () => {
                    const results = await Promise.allSettled([
                        localDB.softDeleteByIndex('lorebooks', 'ownerId', id),
                        localDB.softDeleteByIndex('scripts', 'ownerId', id),
                        localDB.softDeleteByIndex('charjs', 'ownerId', id),
                        localDB.softDeleteRecord('modules', id)
                    ]);
                    const failed = results.find((r) => r.status === 'rejected');
                    if (failed) {
                        throw failed.reason;
                    }
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete module', error);
        }
    }
}
