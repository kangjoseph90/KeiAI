import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type RoomRecord } from '$lib/adapters/db';
import type { EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import { defaultFileFields, hydrateOwnedItems, type FileItem } from './resource';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';

// ─── Domain Types ────────────────────────────────────────────────────

export interface RoomContent {
    name: string;
    files: EntityListConfig<FileItem>;
}

export interface RoomRefs {
    lastActiveChatId?: string;
    chats: EntityListConfig;
    characters: EntityListConfig;
}

export interface RoomFields extends RoomContent, RoomRefs {}

export interface Room extends RoomFields {
    id: string;
    scopeType: DataScopeType;
    scopeId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: RoomFields = {
    name: 'New Room',
    chats: { refs: {}, folders: {} },
    characters: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} }
};

// ─── Helpers ─────────────────────────────────────────────────────────

export function parseFields(record: RoomRecord): RoomFields {
    const fields = deepMerge(defaultFields, record.data as DeepPartial<RoomFields>);
    fields.files.refs = hydrateOwnedItems(fields.files.refs, defaultFileFields);
    return fields;
}

// ─── Service ─────────────────────────────────────────────────────────

export class RoomService {
    static async list(): Promise<Room[]> {
        await buffer.flushTable('rooms');
        const records = await localDB.getAll<RoomRecord>('rooms', getSessionScope('user'));
        return records.map((record) => ({
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        }));
    }

    static async get(id: string): Promise<Room | null> {
        const record = await buffer.get<RoomRecord>('rooms', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    static async create(fields: DeepPartial<RoomFields> = {}): Promise<Room> {
        const resolved: RoomFields = deepMerge(defaultFields, fields);

        const scope = getSessionScope('user');
        const id = generateId();
        const now = clock.now();

        try {
            const record: RoomRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<RoomRecord>('rooms', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create room', error);
        }

        return { ...resolved, id, scopeType: scope.scopeType, scopeId: scope.scopeId };
    }

    static async update(id: string, changes: DeepPartial<RoomFields>): Promise<Room> {
        const record = await buffer.get<RoomRecord>('rooms', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Room not found');
        }

        try {
            const current = parseFields(record);
            const updated: RoomFields = deepMerge(current, changes);

            buffer.update<RoomRecord>({
                tableName: 'rooms',
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
            throw new AppError('DB_WRITE_FAILED', 'Failed to update room', error);
        }
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<RoomRecord>('rooms', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Room not found: ${id}`);
        }

        if (record.scopeType !== 'user') {
            throw new AppError('INVALID_INPUT', `Cannot delete a shared room: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('rooms');
            await Promise.all(
                (['rooms', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );

            buffer.drop('rooms', record.id);
            const result = await localDB.transaction(
                ['rooms', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('rooms', id);
                    await localDB.softDeleteRecord('rooms', id);
                    return cascadeResult;
                }
            );

            await cleanupCascadeAssets(result);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete room', error);
        }
    }
}
