import { clock } from '$lib/utils/clock';
import { canAccessScope, getSessionScope } from '../session';
import { localDB, type DataScopeType, type FileRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { buffer } from './record_buffer';
import type { FileNamespace } from '$lib/workflow';

export interface FileFields {
    namespace: FileNamespace;
    path: string;
    content: string;
}

export interface FileEntry extends FileFields {
    id: string;
    namespaceId: string;
    scopeType: DataScopeType;
    scopeId: string;
}

const defaultFileFields: FileFields = {
    namespace: 'global',
    path: '',
    content: ''
};

function parseFields(record: FileRecord): FileFields {
    return deepMerge(defaultFileFields, record.data as DeepPartial<FileFields>);
}

function parseFile(record: FileRecord): FileEntry {
    return {
        ...parseFields(record),
        id: record.id,
        namespaceId: record.ownerId,
        scopeType: record.scopeType,
        scopeId: record.scopeId
    };
}

function normalizePath(path: string): string {
    const normalized = path.trim();
    if (!normalized) throw new AppError('INVALID_INPUT', 'File path is required');
    return normalized;
}

export class FileService {
    static async list(namespace: FileNamespace, namespaceId: string): Promise<FileEntry[]> {
        await buffer.flushTable('files');
        const records = await localDB.getByIndex<FileRecord>(
            'files',
            'ownerId',
            namespaceId,
            Number.MAX_SAFE_INTEGER
        );

        return records
            .filter(
                (record) => canAccessScope(record) && parseFields(record).namespace === namespace
            )
            .map(parseFile);
    }

    static async get(id: string): Promise<FileEntry | null> {
        const record = await buffer.get<FileRecord>('files', id);
        if (!record || record.isDeleted || !canAccessScope(record)) return null;
        return parseFile(record);
    }

    static async getByPath(
        namespace: FileNamespace,
        namespaceId: string,
        path: string
    ): Promise<FileEntry | null> {
        const normalizedPath = normalizePath(path);
        const files = await this.list(namespace, namespaceId);
        return files.find((file) => file.path === normalizedPath) ?? null;
    }

    static async create(
        namespace: FileNamespace,
        namespaceId: string,
        fields: { path: string; content?: string },
        scopeType: DataScopeType = 'user'
    ): Promise<FileEntry> {
        if (namespace === 'global' && scopeType !== 'user') {
            throw new AppError('INVALID_INPUT', 'Global files must use user data scope');
        }

        const path = normalizePath(fields.path);
        if (await this.getByPath(namespace, namespaceId, path)) {
            throw new AppError('INVALID_INPUT', `File already exists: ${path}`);
        }

        const scope = getSessionScope(scopeType);
        const id = generateId();
        const now = clock.now();
        const data: FileFields = {
            namespace,
            path,
            content: fields.content ?? ''
        };

        try {
            const record: FileRecord = {
                id,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                ownerId: namespaceId,
                createdAt: now,
                updatedAt: now,
                isDeleted: false,
                data: data as unknown as Record<string, unknown>
            };
            await localDB.putRecord<FileRecord>('files', record);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to create file', error);
        }

        return {
            ...data,
            id,
            namespaceId,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId
        };
    }

    static async update(
        id: string,
        changes: DeepPartial<Pick<FileFields, 'path' | 'content'>>
    ): Promise<FileEntry> {
        const record = await buffer.get<FileRecord>('files', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `File not found: ${id}`);
        }

        const current = parseFields(record);
        const nextPath = changes.path === undefined ? current.path : normalizePath(changes.path);
        if (nextPath !== current.path) {
            const conflict = await this.getByPath(current.namespace, record.ownerId, nextPath);
            if (conflict && conflict.id !== id) {
                throw new AppError('INVALID_INPUT', `File already exists: ${nextPath}`);
            }
        }

        const updated: FileFields = deepMerge(current, { ...changes, path: nextPath });
        buffer.update<FileRecord>({
            tableName: 'files',
            record: { ...record, data: updated as unknown as Record<string, unknown> },
            patch: { ...changes, path: nextPath } as Record<string, unknown>
        });

        return {
            ...updated,
            id: record.id,
            namespaceId: record.ownerId,
            scopeType: record.scopeType,
            scopeId: record.scopeId
        };
    }

    static async upsert(
        namespace: FileNamespace,
        namespaceId: string,
        path: string,
        content: string,
        scopeType: DataScopeType = 'user'
    ): Promise<FileEntry> {
        const existing = await this.getByPath(namespace, namespaceId, path);
        if (existing) return this.update(existing.id, { content });
        return this.create(namespace, namespaceId, { path, content }, scopeType);
    }

    static async delete(id: string): Promise<void> {
        const record = await buffer.get<FileRecord>('files', id);
        if (!record || record.isDeleted || !canAccessScope(record)) {
            throw new AppError('NOT_FOUND', `File not found: ${id}`);
        }

        buffer.drop('files', id);
        await localDB.softDeleteRecord('files', id);
    }
}
