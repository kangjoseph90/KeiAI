import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type CharJSRecord, type DataScopeType } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface CharJSFields {
    name: string;
    code: string;
    enabled: boolean;
}

export interface CharJS extends CharJSFields {
    id: string;
    ownerId: string;
    scopeType: DataScopeType;
    scopeId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultCharJSFields: CharJSFields = {
    name: 'New Script',
    code: '',
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: CharJSRecord): CharJSFields {
    return deepMerge(defaultCharJSFields, record.data as DeepPartial<CharJSFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class CharJSService {
    /** List charjs scripts owned by a specific parent (character, module) */
    static async listByOwner(ownerId: string): Promise<CharJS[]> {
        await buffer.flushTable('charjs');
        const records = await localDB.getByIndex<CharJSRecord>(
            'charjs',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );

        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                ownerId: record.ownerId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            }));
    }

    static async get(id: string): Promise<CharJS | null> {
        const record = await buffer.get<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            ownerId: record.ownerId,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    static async create(
        ownerId: string,
        fields: DeepPartial<CharJSFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<CharJS> {
        const resolved: CharJSFields = deepMerge(defaultCharJSFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: CharJSRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                ownerId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<CharJSRecord>('charjs', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create charjs script', error);
        }

        return { ...resolved, id, ownerId, scopeType: scope.scopeType, scopeId: scope.scopeId };
    }

    static async update(id: string, changes: DeepPartial<CharJSFields>): Promise<CharJS> {
        const record = await buffer.get<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `CharJS script not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: CharJSFields = deepMerge(current, changes);

            buffer.update<CharJSRecord>({
                tableName: 'charjs',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                ownerId: record.ownerId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update charjs script', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `CharJS script not found: ${id}`);
        }

        try {
            buffer.drop('charjs', id);
            return localDB.softDeleteRecord('charjs', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete charjs script', error);
        }
    }

    /**
     * Subscribes to local database changes for CharJS records, allowing runtime
     * environments or UI components to automatically invalidate cache instantly.
     */
    static onChange(callback: (id: string) => void): () => void {
        return localDB.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (event.tableName === 'charjs') {
                    for (const id of event.ids) {
                        callback(id);
                    }
                }
            }
        });
    }
}
