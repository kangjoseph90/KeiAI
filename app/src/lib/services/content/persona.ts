import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type PersonaRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import type { AssetRef } from '$lib/types/refs';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaContent {
    name: string;
    description: string;
}

export interface PersonaRefs {
    avatarAssetId?: string;
    assets?: AssetRef[];
}

export interface PersonaFields extends PersonaContent, PersonaRefs {}

export interface Persona extends PersonaFields {
    id: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultPersonaFields: PersonaFields = {
    name: 'New Persona',
    description: ''
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: PersonaRecord): PersonaFields {
    return deepMerge(defaultPersonaFields, record.data as DeepPartial<PersonaFields>);
}

// ─── Service ─────────────────────────────────────────────────────────

export class PersonaService {
    /** List all personas */
    static async list(): Promise<Persona[]> {
        await writeQueue.flushTable('personas');
        const { userId } = getActiveSession();
        const records = await localDB.getAll<PersonaRecord>('personas', userId);

        return records.map((record) => ({
            id: record.id,
            ...parseFields(record)
        }));
    }

    static async get(id: string): Promise<Persona | null> {
        const queued = writeQueue.peek<PersonaFields>('personas', id);
        if (queued) {
            const record = await localDB.getRecord<PersonaRecord>('personas', id);
            if (!record || record.isDeleted) return null;
            return {
                id,
                ...deepMerge(defaultPersonaFields, queued)
            };
        }

        const record = await localDB.getRecord<PersonaRecord>('personas', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            ...parseFields(record)
        };
    }

    /** Create a persona */
    static async create(fields: DeepPartial<PersonaFields> = {}): Promise<Persona> {
        const resolved: PersonaFields = deepMerge(defaultPersonaFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: PersonaRecord = {
                id,
                userId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<PersonaRecord>('personas', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create persona', error);
        }

        return { id, ...resolved };
    }

    /** Update a persona */
    static async update(id: string, changes: DeepPartial<PersonaFields>): Promise<Persona> {
        const queued = writeQueue.peek<PersonaFields>('personas', id);
        const record = await localDB.getRecord<PersonaRecord>('personas', id);
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
        }

        try {
            const current = queued ? deepMerge(defaultPersonaFields, queued) : parseFields(record);
            const updated: PersonaFields = deepMerge(current, changes);

            writeQueue.upsert<PersonaFields, PersonaRecord>({
                tableName: 'personas',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update persona', error);
        }
    }

    /** Delete a persona */
    static async delete(id: string): Promise<void> {
        try {
            writeQueue.drop('personas', id);
            await localDB.softDeleteRecord('personas', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete persona', error);
        }
    }
}
