import { clock } from '$lib/utils/clock';
import { canAccessUserScope, getSessionScope } from '../session';
import { localDB, type PluginRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

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
        await buffer.flushTable('plugins');
        const records = await localDB.getAll<PluginRecord>('plugins', getSessionScope('user'));

        return records.map((record) => ({
            ...parseFields(record),
            id: record.id
        }));
    }

    static async get(id: string): Promise<Plugin | null> {
        const record = await buffer.get<PluginRecord>('plugins', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id
        };
    }

    static async create(fields: DeepPartial<PluginFields> = {}): Promise<Plugin> {
        const resolved: PluginFields = deepMerge(defaultPluginFields, fields);

        const scope = getSessionScope('user');
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: PluginRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
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

        return { ...resolved, id };
    }

    static async update(id: string, changes: DeepPartial<PluginFields>): Promise<Plugin> {
        const record = await buffer.get<PluginRecord>('plugins', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Plugin not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: PluginFields = deepMerge(current, changes);

            buffer.update<PluginRecord>({
                tableName: 'plugins',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update plugin', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<PluginRecord>('plugins', id);
        if (!record || record.isDeleted || !canAccessUserScope(record)) {
            throw new AppError('NOT_FOUND', `Plugin not found: ${id}`);
        }

        try {
            buffer.drop('plugins', id);
            await localDB.softDeleteRecord('plugins', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete plugin', error);
        }
    }
}
