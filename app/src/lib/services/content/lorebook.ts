import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type LorebookRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface LorebookFields {
    name: string;
    keys: string[];
    content: string;
    insertionDepth: number;
    enabled: boolean;
    regex?: string;
    probability?: number;
}

export interface Lorebook extends LorebookFields {
    id: string;
    ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultLorebookFields: LorebookFields = {
    name: 'New Lorebook',
    keys: [],
    content: '',
    insertionDepth: 0,
    enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: LorebookRecord): LorebookFields {
    return deepMerge(defaultLorebookFields, record.data as DeepPartial<LorebookFields>);
}

// ─── Service ──────────────────────────────────────────────────────────

export class LorebookService {
    /** List lorebooks owned by a specific parent (character, chat, module) */
    static async listByOwner(ownerId: string): Promise<Lorebook[]> {
        await writeQueue.flushTable('lorebooks');
        const records = await localDB.getByIndex<LorebookRecord>(
            'lorebooks',
            'ownerId',
            ownerId,
            Number.MAX_SAFE_INTEGER
        );
        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            ownerId: record.ownerId
        }));
    }

    static async get(id: string): Promise<Lorebook | null> {
        const cached = writeQueue.peek<LorebookRecord>('lorebooks', id);
        if (cached) {
            if (cached.isDeleted) return null;
            return {
                ...parseFields(cached),
                id: cached.id,
                ownerId: cached.ownerId
            };
        }

        const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
        if (!record || record.isDeleted) return null;

        return {
            ...parseFields(record),
            id: record.id,
            ownerId: record.ownerId
        };
    }

    static async create(
        ownerId: string,
        fields: DeepPartial<LorebookFields> = {}
    ): Promise<Lorebook> {
        const resolved: LorebookFields = deepMerge(defaultLorebookFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: LorebookRecord = {
                id,
                userId,
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
        const cached = writeQueue.peek<LorebookRecord>('lorebooks', id);
        const record = cached ?? (await localDB.getRecord<LorebookRecord>('lorebooks', id));
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `Lorebook not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: LorebookFields = deepMerge(current, changes);

            writeQueue.update<LorebookRecord>({
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
        try {
            writeQueue.drop('lorebooks', id);
            await localDB.softDeleteRecord('lorebooks', id);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete lorebook', error);
        }
    }
}
