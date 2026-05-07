import { clock } from '$lib/utils/clock';
import { getActiveSession, UserService } from '../user';
import { localDB, type ScriptRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ScriptFields {
    type: 'regex';
    name: string;
    regex: string;
    replacement: string;
    phase: 'input' | 'request' | 'output' | 'display';
    advanced: boolean; // use advanced settings
    flag: string;
    order: number;
    repeat: number;
    enabled: boolean;
}

export interface Script extends ScriptFields {
    id: string;
    ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultScriptFields: ScriptFields = {
    type: 'regex',
    name: 'New Script',
    regex: '',
    replacement: '',
    phase: 'display',
    advanced: false,
    flag: 'g',
    order: 100,
    repeat: 1,
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ScriptRecord): ScriptFields {
    return deepMerge(defaultScriptFields, record.data as DeepPartial<ScriptFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class ScriptService {
    /** List scripts owned by a specific parent (character, module) */
    static async listByOwner(ownerId: string): Promise<Script[]> {
        await buffer.flushTable('scripts');
        const { userId } = getActiveSession();
        const records = await localDB.getByIndex<ScriptRecord>(
            'scripts',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );

        return records
            .filter((record) => record.userId === userId)
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                ownerId: record.ownerId
            }));
    }

    static async get(id: string): Promise<Script | null> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted || record.userId !== userId) return null;

        return {
            ...parseFields(record),
            id: record.id,
            ownerId: record.ownerId
        };
    }

    static async create(ownerId: string, fields: DeepPartial<ScriptFields> = {}): Promise<Script> {
        const resolved: ScriptFields = deepMerge(defaultScriptFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: ScriptRecord = {
                id,
                userId,
                ownerId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ScriptRecord>('scripts', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create script', error);
        }

        return { ...resolved, id, ownerId };
    }

    static async update(id: string, changes: DeepPartial<ScriptFields>): Promise<Script> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Script not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: ScriptFields = deepMerge(current, changes);

            buffer.update<ScriptRecord>({
                tableName: 'scripts',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id, ownerId: record.ownerId };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update script', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const { userId } = getActiveSession();
        const record = await buffer.get<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted || record.userId !== userId) {
            throw new AppError('NOT_FOUND', `Script not found: ${id}`);
        }

        try {
            buffer.drop('scripts', id);
            await localDB.softDeleteRecord('scripts', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete script', error);
        }
    }
}
