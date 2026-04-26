import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type PluginRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PluginFields {
    name: string;
    description: string;
    version: string;
    code: string; // Sandboxed JS source
    args: Record<string, unknown>; // KV storage
    enabled: boolean;
}

export interface Plugin extends PluginFields {
    id: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultPluginFields: PluginFields = {
    name: 'New Plugin',
    description: '',
    version: '',
    code: '',
    args: {},
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: PluginRecord): PluginFields {
    return deepMerge(defaultPluginFields, record.data as DeepPartial<PluginFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class PluginService {
    static async list(): Promise<Plugin[]> {
        await writeQueue.flushTable('plugins');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<PluginRecord>('plugins', userId);

        return records.map((record) => ({
            id: record.id,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<Plugin | null> {
        const queued = writeQueue.peek<PluginFields>('plugins', id);
        if (queued) {
            const record = await localDB.getRecord<PluginRecord>('plugins', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ...deepMerge(defaultPluginFields, queued)
            };
        }

        const record = await localDB.getRecord<PluginRecord>('plugins', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            ...parseFields(record)
        };
    }

    static async create(fields: DeepPartial<PluginFields> = {}): Promise<Plugin> {
        const resolved: PluginFields = deepMerge(defaultPluginFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: PluginRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<PluginRecord>('plugins', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create plugin', error);
        }

        return { id, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<PluginFields>): Promise<Plugin> {
        const queued = writeQueue.peek<PluginFields>('plugins', id);
        const record = await localDB.getRecord<PluginRecord>('plugins', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Plugin not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultPluginFields, queued) : parseFields(record);
            const updated: PluginFields = deepMerge(current, changes);

            writeQueue.upsert<PluginFields, PluginRecord>({
                tableName: 'plugins',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update plugin', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('plugins', id);
            await localDB.softDeleteRecord('plugins', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete plugin', error);
        }
    }
}
