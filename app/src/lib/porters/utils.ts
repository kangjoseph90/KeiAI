import { AssetService } from '$lib/services/asset';
import type { AssetFields } from '$lib/types/asset';
import type { AssetOwner, AssetLocator } from '$lib/adapters/asset';
import type { AssetRef, EntityListConfig, FolderDef, OrderedRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { generateKeyBetween } from 'fractional-indexing';
import { classifyAsset, type KeiAssetPayload } from './types';

export type KeiPackageExportMode = 'light' | 'baked';
export type ImportedAssetPayload =
    | { kind: 'baked'; data: Uint8Array; fallbackName: string }
    | { kind: 'light'; fields: AssetFields };

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

export function refs<T extends { id: string }>(items: T[]): EntityListConfig<T & OrderedRef> {
    return {
        refs: Object.fromEntries(
            items.map((item, index) => [
                item.id,
                { ...item, id: item.id, sortOrder: sortOrder(index) }
            ])
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
            folderId: ref.folderId ? folderMap[ref.folderId] : undefined
        };
    }

    for (const [id, folder] of Object.entries(list.folders)) {
        const nextId = folderMap[id];
        if (!nextId) continue;
        folders[nextId] = {
            ...folder,
            id: nextId,
            parentId: folder.parentId ? folderMap[folder.parentId] : undefined
        };
    }

    return { refs, folders };
}

export function remapFolders(folders: Record<string, FolderDef>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const id of Object.keys(folders)) {
        map[id] = generateId();
    }
    return map;
}

/**
 * Remap imported asset folder IDs for a freshly created entity.
 * Generates new IDs for every folder and patches refs' folderId fields.
 * Returns null when there are no folders to remap.
 */
export function remapImportedAssetFolders(params: {
    currentRefs: Record<string, AssetRef>;
    layoutIdMap: Record<string, string>;
    pkgRefs: Record<string, AssetRef>;
    pkgFolders: Record<string, FolderDef>;
}): { refs: Record<string, AssetRef>; folders: Record<string, FolderDef> } | null {
    if (Object.keys(params.pkgFolders).length === 0) return null;

    const folderMap = remapFolders(params.pkgFolders);

    const fixedRefs: Record<string, AssetRef> = {};
    for (const [layoutId, ref] of Object.entries(params.currentRefs)) {
        const portableKey = Object.entries(params.layoutIdMap).find(
            ([, newId]) => newId === layoutId
        )?.[0];
        const pkgRef = portableKey ? params.pkgRefs[portableKey] : undefined;

        fixedRefs[layoutId] = {
            ...ref,
            folderId: pkgRef?.folderId ? folderMap[pkgRef.folderId] : undefined
        };
    }

    const fixedFolders: Record<string, FolderDef> = {};
    for (const [id, folder] of Object.entries(params.pkgFolders)) {
        const nextId = folderMap[id];
        if (!nextId) continue;
        fixedFolders[nextId] = {
            ...folder,
            id: nextId,
            parentId: folder.parentId ? folderMap[folder.parentId] : undefined
        };
    }

    return { refs: fixedRefs, folders: fixedFolders };
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
            folderId: ref.folderId ? folderMap[ref.folderId] : undefined
        };
    }

    for (const [id, folder] of Object.entries(list.folders)) {
        const nextId = folderMap[id];
        if (!nextId) continue;
        folders[nextId] = {
            ...folder,
            id: nextId,
            parentId: folder.parentId ? folderMap[folder.parentId] : undefined
        };
    }

    return { refs, folders };
}

export function importEntityList<R extends OrderedRef>(
    list: EntityListConfig<R>
): EntityListConfig<R> {
    const idMap = Object.fromEntries(Object.keys(list.refs).map((id) => [id, generateId()]));
    return remapEntityList(list, idMap);
}

/**
 * Export an asset's blob data as a KeiAssetPayload.
 * Uses the asset's hash + owner context to locate the blob in local storage.
 */
export async function exportAssetPayload(
    fields: AssetFields,
    owner: AssetOwner,
    mode: KeiPackageExportMode
): Promise<KeiAssetPayload> {
    const locator: AssetLocator = { ...owner, hash: fields.hash };

    const payload: KeiAssetPayload = {
        hash: fields.hash,
        encKey: fields.encKey
    };

    if (mode === 'light') return payload;

    let data = await AssetService.readBytes(locator);
    if (!data) {
        await AssetService.load({ ...locator, encKey: fields.encKey });
        data = await AssetService.readBytes(locator);
    }
    if (!data) {
        throw new AppError('NOT_FOUND', `Asset bytes not found: ${fields.hash}`);
    }

    return { ...payload, data };
}

export function importAssetPayload(
    key: string,
    asset: KeiAssetPayload,
    allowLight: boolean
): ImportedAssetPayload {
    const kind = classifyAsset(asset);
    if (kind === 'broken') {
        throw new AppError('INVALID_INPUT', `Broken asset payload: ${key}`);
    }
    if (kind === 'light' && !allowLight) {
        throw new AppError('INVALID_INPUT', `Light asset import is disabled: ${key}`);
    }

    if (kind === 'baked') {
        return {
            kind: 'baked',
            data: asset.data as Uint8Array,
            fallbackName: `${key}.bin`
        };
    }

    return {
        kind: 'light',
        fields: {
            name: `${key}.bin`,
            hash: asset.hash as string,
            encKey: asset.encKey as string,
            mimeType: 'application/octet-stream'
        }
    };
}

export function importAssetPayloads(
    assets: Record<string, KeiAssetPayload>,
    allowLight: boolean
): Record<string, ImportedAssetPayload> {
    const imported: Record<string, ImportedAssetPayload> = {};
    for (const [key, asset] of Object.entries(assets)) {
        imported[key] = importAssetPayload(key, asset, allowLight);
    }
    return imported;
}

export function materializeImportedAsset(
    imported: ImportedAssetPayload,
    metadata: Omit<AssetFields, 'hash' | 'encKey'>
): File | AssetFields {
    if (imported.kind === 'baked') {
        return new File([imported.data.slice()], metadata.name || imported.fallbackName, {
            type: metadata.mimeType || 'application/octet-stream'
        });
    }

    return {
        ...imported.fields,
        name: metadata.name || imported.fields.name,
        mimeType: metadata.mimeType || imported.fields.mimeType,
        width: metadata.width,
        height: metadata.height
    };
}
