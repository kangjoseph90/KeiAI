import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type PersonaRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import type { AssetRef } from '$lib/types/refs';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import { AssetService } from '../asset';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaContent {
    name: string;
    description: string;
}

export interface PersonaRefs {
    avatarAssetId?: string;
    assets: AssetRef[];
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
    assets: []
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseFields(record: PersonaRecord): PersonaFields {
    return deepMerge(defaultPersonaFields, record.data as DeepPartial<PersonaFields>);
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update persona', error);
        }
    }

    /** Delete a persona */
    static async delete(id: string): Promise<void> {
        const record = await buffer.get<PersonaRecord>('personas', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
        }

        const fields = parseFields(record);
        const assetIds: string[] = [];
        if (fields.avatarAssetId) assetIds.push(fields.avatarAssetId);
        for (const ref of fields.assets) {
            assetIds.push(ref.assetId);
        }

        try {
            buffer.drop('personas', id);
            await localDB.softDeleteRecord('personas', id);
            await Promise.allSettled(assetIds.map((assetId) => AssetService.delete(assetId)));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete persona', error);
        }
    }
}
