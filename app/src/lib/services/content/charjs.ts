import { clock } from '$lib/utils/clock';
import { getActiveSession } from '../session';
import { localDB, type CharJSRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { writeQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface CharJSFields {
    name: string;
    code: string;
    enabled: boolean;
}

export interface CharJS extends CharJSFields {
    id: string;
    ownerId: string;
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
        await writeQueue.flushTable('charjs');
        const records = await localDB.getByIndex<CharJSRecord>(
            'charjs',
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

    static async get(id: string): Promise<CharJS | null> {
        const cached = writeQueue.peek<CharJSRecord>('charjs', id);
        if (cached) {
            if (cached.isDeleted) return null;
            return {
                id: cached.id,
                ownerId: cached.ownerId,
                ...parseFields(cached)
            };
        }

        const record = await localDB.getRecord<CharJSRecord>('charjs', id);
        if (!record || record.isDeleted) return null;

        return {
            id: record.id,
            ownerId: record.ownerId,
            ...parseFields(record)
        };
    }

    static async create(ownerId: string, fields: DeepPartial<CharJSFields> = {}): Promise<CharJS> {
        const resolved: CharJSFields = deepMerge(defaultCharJSFields, fields);

        const { userId } = getActiveSession();
        const id = generateId();
        const now = clock.now();

        try {
            const newRecord: CharJSRecord = {
                id,
                userId,
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

        return { id, ownerId, ...resolved };
    }

    static async update(id: string, changes: DeepPartial<CharJSFields>): Promise<CharJS> {
        const cached = writeQueue.peek<CharJSRecord>('charjs', id);
        const record = cached ?? (await localDB.getRecord<CharJSRecord>('charjs', id));
        if (!record || record.isDeleted) {
            throw new AppError('NOT_FOUND', `CharJS script not found: ${id}`);
        }

        try {
            const current = parseFields(record);
            const updated: CharJSFields = deepMerge(current, changes);

            writeQueue.upsert<CharJSRecord>({
                tableName: 'charjs',
                record: { ...record, data: updated as unknown as Record<string, unknown> },
                mergeData: (cur, next) => deepMerge(cur, next) as Record<string, unknown>
            });

            return { id: record.id, ownerId: record.ownerId, ...updated };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update charjs script', error);
        }
    }

    static delete(id: string): Promise<void> {
        try {
            writeQueue.drop('charjs', id);
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
