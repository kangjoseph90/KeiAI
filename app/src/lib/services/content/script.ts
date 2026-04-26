import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type ScriptRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

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
        await writeQueue.flushTable('scripts');
        const records = await localDB.getByIndex<ScriptRecord>(
            'scripts',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );

        return records.map((record) => ({
            id: record.id,
            ownerId: record.ownerId,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<Script | null> {
        const queued = writeQueue.peek<ScriptFields>('scripts', id);
        if (queued) {
            const record = await localDB.getRecord<ScriptRecord>('scripts', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ownerId: record.ownerId,
                ...deepMerge(defaultScriptFields, queued)
            };
        }

        const record = await localDB.getRecord<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            ownerId: record.ownerId,
            ...parseFields(record)
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

        return { id, ownerId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<ScriptFields>): Promise<Script> {
        const queued = writeQueue.peek<ScriptFields>('scripts', id);
        const record = await localDB.getRecord<ScriptRecord>('scripts', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Script not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultScriptFields, queued) : parseFields(record);
            const updated: ScriptFields = deepMerge(current, changes);

            writeQueue.upsert<ScriptFields, ScriptRecord>({
                tableName: 'scripts',
                id,
                userId: record.userId,
                createdAt: record.createdAt,
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({ id: recordId, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id: recordId,
                    userId: recordUserId,
                    ownerId: record.ownerId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });

            return { id, ownerId: record.ownerId, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update script', error);
        }
    }

    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('scripts', id);
            await localDB.softDeleteRecord('scripts', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete script', error);
        }
    }
}
