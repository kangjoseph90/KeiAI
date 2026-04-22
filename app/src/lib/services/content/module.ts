import { clock } from '$lib/utils/clock';
import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ModuleRecord } from '$lib/adapters/db';
import type { AssetRef, FolderDef, OrderedRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

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

function decryptFields(masterKey: CryptoKey, record: ModuleRecord): Promise<ModuleFields> {
    return decrypt(masterKey, {
        ciphertext: record.encryptedData,
        iv: record.encryptedDataIV
    })
        .then((dec) => deepMerge(defaultModuleFields, JSON.parse(dec)))
        .catch((error) => {
            throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt module', error);
        });
}

// ─── Service ──────────────────────────────────────────────────────────

export class ModuleService {
    static async list(): Promise<Module[]> {
        await encryptedWriteQueue.flushTable('modules');
        const { masterKey, userId } = getActiveSession();
        const records = await localDB.getAll<ModuleRecord>('modules', userId);

        return Promise.all(
            records.map(async (record) => {
                const fields = await decryptFields(masterKey, record);
                return {
                    id: record.id,
                    ...fields
                };
            })
        );
    }

    static async get(id: string): Promise<Module | null> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ModuleFields>('modules', id);
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

        const fields = await decryptFields(masterKey, record);
        return {
            id: record.id,
            ...fields
        };
    }

    static async create(fields: DeepPartial<ModuleFields> = {}): Promise<Module> {
        const resolved: ModuleFields = deepMerge(defaultModuleFields, fields);

        const { masterKey, userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const enc = await encrypt(masterKey, JSON.stringify(resolved));
            const newRecord: ModuleRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                encryptedData: enc.ciphertext,
                encryptedDataIV: enc.iv
            };
            await localDB.putRecord<ModuleRecord>('modules', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create module', error);
        }

        return { id, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ModuleFields>): Promise<Module> {
        const { masterKey } = getActiveSession();
        const queued = encryptedWriteQueue.peek<ModuleFields>('modules', id);
        const record = await localDB.getRecord<ModuleRecord>('modules', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Module not found: ${id}`);
        }

        try {
            const current = queued
                ? deepMerge(defaultModuleFields, queued)
                : await decryptFields(masterKey, record);
            const updated: ModuleFields = deepMerge(current, changes);

            encryptedWriteQueue.upsert<ModuleFields, ModuleRecord>({
                tableName: 'modules',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update module', error);
        }
    }

    /** Update content fields only ??safe entry point for store layer */
    static async updateContent(id: string, changes: DeepPartial<ModuleContent>): Promise<Module> {
        return this.update(id, changes);
    }

    static async delete(id: string): Promise<void> {
        try {
            await Promise.all([
                encryptedWriteQueue.flushTable('modules'),
                encryptedWriteQueue.flushTable('lorebooks'),
                encryptedWriteQueue.flushTable('scripts'),
                encryptedWriteQueue.flushTable('charjs')
            ]);

            encryptedWriteQueue.drop('modules', id);
            await localDB.transaction(
                ['lorebooks', 'scripts', 'charjs', 'modules'],
                'rw',
                async () => {
                    await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
                    await localDB.softDeleteByIndex('scripts', 'ownerId', id);
                    await localDB.softDeleteByIndex('charjs', 'ownerId', id);
                    await localDB.softDeleteRecord('modules', id);
                }
            );
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete module', error);
        }
    }
}
