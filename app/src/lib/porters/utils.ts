import type { DataScopeType } from '$lib/adapters/db';
import { AssetService } from '$lib/services/asset';
import type { EntityListConfig, FolderDef, OrderedRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { generateKeyBetween } from 'fractional-indexing';
import { classifyAsset, type KeiAssetPayload } from './types';

export type KeiPackageExportMode = 'light' | 'baked';

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SORT_ORDER_KEYS: string[] = [];

export function sortOrder(index: number): string {
    while (SORT_ORDER_KEYS.length <= index) {
        const previous = SORT_ORDER_KEYS.at(-1) ?? null;
        SORT_ORDER_KEYS.push(generateKeyBetween(previous, null));
    }
    return SORT_ORDER_KEYS[index];
}

export function refs<T extends { id: string }>(items: T[]): EntityListConfig {
    return {
        refs: Object.fromEntries(
            items.map((item, index) => [item.id, { id: item.id, sortOrder: sortOrder(index) }])
        ),
        folders: {}
    };
}

export function readDefaultVariables(value: string | undefined): Record<string, string> {
    if (!value) return {};
    const variables: Record<string, string> = {};
    for (const line of value.split(/\r?\n/)) {
        const index = line.indexOf('=');
        if (index <= 0) continue;
        variables[line.slice(0, index).trim()] = line.slice(index + 1);
    }
    return variables;
}

export function writeDefaultVariables(vars: Record<string, string>): string {
    return Object.entries(vars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
}

export function normalizeCharacterMacros(content: string): string {
    return content
        .replace(/<\s*(char|bot)\s*>/gi, '{{char}}')
        .replace(/<\s*user\s*>/gi, '{{user}}');
}

export function createPortableIdMap(ids: string[], prefix: string): Record<string, string> {
    let next = 0;
    const map: Record<string, string> = {};
    for (const id of ids) {
        map[id] = `${prefix}_${next++}`;
    }
    return map;
}

function mapFolders(folders: Record<string, FolderDef>, prefix: string): Record<string, string> {
    return createPortableIdMap(Object.keys(folders), prefix);
}

export function exportEntityList<R extends OrderedRef>(
    list: EntityListConfig<R>,
    idMap: Record<string, string>,
    folderPrefix: string
): EntityListConfig<R> {
    const folderMap = mapFolders(list.folders, folderPrefix);
    const refs: Record<string, R> = {};
    const folders: Record<string, FolderDef> = {};

    for (const [id, ref] of Object.entries(list.refs)) {
        const nextId = idMap[id];
        if (!nextId) {
            throw new AppError('INVALID_INPUT', `Missing package id mapping: ${id}`);
        }
        refs[nextId] = {
            ...ref,
            id: nextId,
            ...(ref.folderId ? { folderId: folderMap[ref.folderId] } : {})
        };
    }

    for (const [id, folder] of Object.entries(list.folders)) {
        const nextId = folderMap[id];
        if (!nextId) continue;
        folders[nextId] = {
            ...folder,
            id: nextId,
            ...(folder.parentId ? { parentId: folderMap[folder.parentId] } : {})
        };
    }

    return { refs, folders };
}

function remapFolders(folders: Record<string, FolderDef>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const id of Object.keys(folders)) {
        map[id] = generateId();
    }
    return map;
}

export function remapEntityList<R extends OrderedRef>(
    list: EntityListConfig<R>,
    idMap: Record<string, string>
): EntityListConfig<R> {
    const folderMap = remapFolders(list.folders);
    const refs: Record<string, R> = {};
    const folders: Record<string, FolderDef> = {};

    for (const [id, ref] of Object.entries(list.refs)) {
        const nextId = idMap[id];
        if (!nextId) {
            throw new AppError('INVALID_INPUT', `Missing package payload: ${id}`);
        }
        refs[nextId] = {
            ...ref,
            id: nextId,
            ...(ref.folderId ? { folderId: folderMap[ref.folderId] } : {})
        };
    }

    for (const [id, folder] of Object.entries(list.folders)) {
        const nextId = folderMap[id];
        if (!nextId) continue;
        folders[nextId] = {
            ...folder,
            id: nextId,
            ...(folder.parentId ? { parentId: folderMap[folder.parentId] } : {})
        };
    }

    return { refs, folders };
}

export async function exportAsset(
    id: string,
    portableId: string,
    mode: KeiPackageExportMode
): Promise<KeiAssetPayload> {
    const fields = await AssetService.getFields(id);
    const payload: KeiAssetPayload = {
        id: portableId,
        hash: fields.hash,
        encKey: fields.encKey
    };

    if (mode === 'light' && fields.status === 'remote') {
        return payload;
    }

    const data = await AssetService.readBytes(id);
    if (!data) {
        throw new AppError('NOT_FOUND', `Asset bytes not found: ${id}`);
    }

    return { ...payload, data };
}

export async function importAssets(
    assets: KeiAssetPayload[],
    scopeType: DataScopeType,
    allowLightAssets: boolean
): Promise<Record<string, string>> {
    const map: Record<string, string> = {};

    for (const asset of assets) {
        const kind = classifyAsset(asset);
        if (kind === 'broken') {
            throw new AppError('INVALID_INPUT', `Broken asset payload: ${asset.id}`);
        }

        if (kind === 'light' && !allowLightAssets) {
            throw new AppError('INVALID_INPUT', `Light asset import is disabled: ${asset.id}`);
        }
    }

    for (const asset of assets) {
        const kind = classifyAsset(asset);
        if (kind === 'light') {
            map[asset.id] = await AssetService.write(null, 'resource', {
                scopeType,
                hash: asset.hash,
                encKey: asset.encKey
            });
            continue;
        }

        const bytes = asset.data as Uint8Array;
        const file = new File([bytes.slice()], `${asset.id}.bin`);
        map[asset.id] = await AssetService.write(file, 'resource', { scopeType });
    }

    return map;
}

export function requireMapped(map: Record<string, string>, id: string): string {
    const mapped = map[id];
    if (!mapped) {
        throw new AppError('INVALID_INPUT', `Missing package payload: ${id}`);
    }
    return mapped;
}
