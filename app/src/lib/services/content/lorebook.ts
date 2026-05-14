import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type LorebookRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import type { LLMRole } from '$lib/types/models/llm';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface LorebookFields {
    name: string;
    key: string;
    secondKey: string;
    content: string;

    depth: number;
    order: number;

    alwaysActive: boolean;
    disabled: boolean;

    role: LLMRole;
    useRegex: boolean;
    useMultipleKeys: boolean;
    scanDepth?: number;
    probability: number;
    recursive: boolean; // triggers other lorebooks when this lorebook is activated
    noRecursiveSearch: boolean; // prevents this lorebook from being triggered by other lorebooks
}

export interface Lorebook extends LorebookFields {
    id: string;
    ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultLorebookFields: LorebookFields = {
    name: 'New Lorebook',
    key: '',
    secondKey: '',
    content: '',
    depth: 0,
    order: 100,
    alwaysActive: false,
    disabled: false,
    role: 'system',
    useRegex: false,
    useMultipleKeys: false,
    probability: 100,
    recursive: false,
    noRecursiveSearch: false
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: LorebookRecord): LorebookFields {
    return deepMerge(defaultLorebookFields, record.data as DeepPartial<LorebookFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class LorebookService {
    /** List lorebooks owned by a specific parent (character, chat, module) */
    static async listByOwner(ownerId: string): Promise<Lorebook[]> {
        await buffer.flushTable('lorebooks');
        const records = await localDB.getByIndex<LorebookRecord>(
            'lorebooks',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );
        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                ownerId: record.ownerId
            }));
    }

    static async get(id: string): Promise<Lorebook | null> {
        const record = await buffer.get<LorebookRecord>('lorebooks', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            ownerId: record.ownerId
        };
    }

    static async create(
        ownerId: string,
        fields: DeepPartial<LorebookFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<Lorebook> {
        const resolved: LorebookFields = deepMerge(defaultLorebookFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: LorebookRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                ownerId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<LorebookRecord>('lorebooks', newRecord);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create lorebook', error);
        }

        return { ...resolved, id, ownerId };
    }

    static async update(id: string, changes: DeepPartial<LorebookFields>): Promise<Lorebook> {
        const record = await buffer.get<LorebookRecord>('lorebooks', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Lorebook not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: LorebookFields = deepMerge(current, changes);

            buffer.update<LorebookRecord>({
                tableName: 'lorebooks',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                patch: changes as unknown as Record<string, unknown>
            });

            return { ...updated, id: record.id, ownerId: record.ownerId };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update lorebook', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<LorebookRecord>('lorebooks', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Lorebook not found: ${id}`);
        }

        try {
            buffer.drop('lorebooks', id);
            await localDB.softDeleteRecord('lorebooks', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete lorebook', error);
        }
    }
}
