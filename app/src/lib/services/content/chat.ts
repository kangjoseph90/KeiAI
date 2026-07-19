import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type ChatRecord, type DataScopeType } from '$lib/adapters/db';
import type { AssetRef, EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import {
    cascadeDeleteChildren,
    getCascadeTables,
    cleanupCascadeAssets,
    type CascadeResult
} from './cascade';
import { AssetService, type AssetOwner } from '../asset';
import type { AssetEntries, AssetFields, AssetStatus } from '$lib/types/asset';
import { defaultLorebookFields, type Lorebook } from './resource';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ChatContent {
    title: string;
    chatNote: string;
    lorebooks: EntityListConfig<Lorebook>;
}

export interface ChatRefs {
    lastMessageId?: string;
    messageCount: number;
    greetingMessageId?: string;
    defaultPersonaId?: string;
    defaultCharacterId?: string;
    personas: EntityListConfig;
    inlays: EntityListConfig<AssetRef>;
}

export interface ChatFields extends ChatContent, ChatRefs {}

export interface Chat extends ChatFields {
    id: string;
    roomId: string;
    scopeType: DataScopeType;
    scopeId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultFields: ChatFields = {
    title: 'New Chat',
    chatNote: '',
    messageCount: 0,
    lorebooks: { refs: {}, folders: {} },
    personas: { refs: {}, folders: {} },
    inlays: { refs: {}, folders: {} }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseFields(record: ChatRecord): ChatFields {
    const fields = deepMerge(defaultFields, record.data as DeepPartial<ChatFields>);

    for (const [id, ref] of Object.entries(fields.lorebooks.refs)) {
        fields.lorebooks.refs[id] = deepMerge(defaultLorebookFields, ref) as Lorebook;
    }

    return fields;
}

function assetOwner(record: ChatRecord): AssetOwner {
    return {
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        ownerTable: 'chats',
        ownerId: record.id
    };
}

function collectAssetFields(fields: ChatFields): AssetFields[] {
    return Object.values(fields.inlays.refs).filter((asset): asset is AssetRef =>
        Boolean(asset?.hash)
    );
}

// ─── Service ──────────────────────────────────────────────────────────

export class ChatService {
    static async listByRoom(roomId: string): Promise<Chat[]> {
        await buffer.flushTable('chats');
        const records = await localDB.getByIndex<ChatRecord>(
            'chats',
            'roomId',
            roomId,
            Number.MAX_SAFE_INTEGER
        );

        return records
            .filter((record) => canAccessScope(record))
            .map((record) => ({
                ...parseFields(record),
                id: record.id,
                roomId: record.roomId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            }));
    }

    static async get(id: string): Promise<Chat | null> {
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;

        return {
            ...parseFields(record),
            id: record.id,
            roomId: record.roomId,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    static async create(
        roomId: string,
        fields: DeepPartial<ChatFields> = {},
        scopeType: DataScopeType = 'user'
    ): Promise<Chat> {
        const resolved: ChatFields = deepMerge(defaultFields, fields);

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();

        try {
            const record: ChatRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                roomId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                assetEntries: {},
                data: resolved as unknown as Record<string, unknown>
            };
            await localDB.putRecord<ChatRecord>('chats', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create chat', error);
        }

        return { ...resolved, id, roomId, scopeType: scope.scopeType, scopeId: scope.scopeId };
    }

    static async update(id: string, changes: DeepPartial<ChatFields>): Promise<Chat> {
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        try {
            const current = parseFields(record);
            const updated: ChatFields = deepMerge(current, changes);

            buffer.update<ChatRecord>({
                tableName: 'chats',
                record: {
                    ...record,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: changes as unknown as Record<string, unknown>
            });

            return {
                ...updated,
                id: record.id,
                roomId: record.roomId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update chat', error);
        }
    }

    static async createInlay(
        id: string,
        asset: File | AssetFields,
        sortOrder: string
    ): Promise<{ chat: Chat; ref: AssetRef }> {
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        const current = parseFields(record);
        const owner = assetOwner(record);

        let fields: AssetFields;
        let status: AssetStatus;

        if (asset instanceof File) {
            fields = await AssetService.write(asset, owner);
            status = 'local';
        } else {
            fields = asset;
            status = 'remote';
        }

        const assetEntries = { ...record.assetEntries };
        if (!(fields.hash in assetEntries)) {
            assetEntries[fields.hash] = status;
        }

        const assetId = generateId();
        const newRef: AssetRef = {
            id: assetId,
            sortOrder,
            ...fields
        };

        const updated: ChatFields = {
            ...current,
            inlays: {
                ...current.inlays,
                refs: {
                    ...current.inlays.refs,
                    [assetId]: newRef
                }
            }
        };

        try {
            buffer.update<ChatRecord>({
                tableName: 'chats',
                record: {
                    ...record,
                    assetEntries,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: { inlays: { refs: { [assetId]: newRef } } }
            });
        } catch (error) {
            if (asset instanceof File) {
                await AssetService.delete({ ...owner, hash: fields.hash }).catch(() => undefined);
            }
            throw error;
        }

        return {
            chat: {
                ...updated,
                id: record.id,
                roomId: record.roomId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            },
            ref: newRef
        };
    }

    static async deleteInlay(id: string, assetId: string): Promise<Chat> {
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', 'Chat not found');
        }

        const current = parseFields(record);
        const refToDelete = current.inlays.refs[assetId];
        if (!refToDelete) {
            return {
                ...current,
                id: record.id,
                roomId: record.roomId,
                scopeType: record.scopeType,
                scopeId: record.scopeId
            };
        }

        const nextRefs = { ...current.inlays.refs };
        delete nextRefs[assetId];

        const updated: ChatFields = {
            ...current,
            inlays: {
                ...current.inlays,
                refs: nextRefs
            }
        };

        const nextFields = collectAssetFields(updated);
        const hashStillExists = nextFields.some((f) => f.hash === refToDelete.hash);

        const assetEntries = { ...record.assetEntries };
        if (!hashStillExists) {
            delete assetEntries[refToDelete.hash];
        }

        buffer.update<ChatRecord>({
            tableName: 'chats',
            record: {
                ...record,
                assetEntries,
                data: updated as unknown as Record<string, unknown>
            },
            patch: { inlays: { refs: { [assetId]: undefined } } }
        });

        if (!hashStillExists) {
            await AssetService.delete({ ...assetOwner(record), hash: refToDelete.hash }).catch(
                () => undefined
            );
        }

        return {
            ...updated,
            id: record.id,
            roomId: record.roomId,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    /** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
    static async delete(id: string): Promise<void> {
        const record = await buffer.get<ChatRecord>('chats', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `Chat not found: ${id}`);
        }

        try {
            const cascadeTables = getCascadeTables('chats');
            await Promise.all(
                (['chats', ...cascadeTables] as const).map((t) => buffer.flushTable(t))
            );

            buffer.drop('chats', id);
            const result = await localDB.transaction(
                ['chats', ...cascadeTables],
                'rw',
                async (): Promise<CascadeResult> => {
                    const cascadeResult = await cascadeDeleteChildren('chats', id);
                    await localDB.softDeleteRecord('chats', id);
                    return cascadeResult;
                }
            );

            await AssetService.deleteOwnerAssets(assetOwner(record));
            await cleanupCascadeAssets(result);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to delete chat', error);
        }
    }
}
