import { CharacterService, CharJSService, LorebookService, ScriptService } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import type { AssetRef, EntityListConfig, FolderDef, OrderedRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiAssetPayload, KeiCharacterPackageV1, KeiCharacterPayload } from './types';

export type KeiCharacterExportMode = 'light' | 'baked';

export interface ExportCharacterOptions {
    mode?: KeiCharacterExportMode;
}

function createIdAllocator(prefix: string): () => string {
    let next = 0;
    return () => `${prefix}_${next++}`;
}

function mapById(ids: string[], prefix: string): Record<string, string> {
    const allocate = createIdAllocator(prefix);
    const map: Record<string, string> = {};
    for (const id of ids) {
        map[id] = allocate();
    }
    return map;
}

function mapFolders(folders: Record<string, FolderDef>, prefix: string): Record<string, string> {
    return mapById(Object.keys(folders), prefix);
}

function exportEntityList<R extends OrderedRef>(
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

function collectAssetIds(character: KeiCharacterPayload): string[] {
    const ids = new Set<string>();
    if (character.avatarAssetId) ids.add(character.avatarAssetId);
    for (const id of Object.keys(character.assets.refs)) {
        ids.add(id);
    }
    return [...ids];
}

async function exportAsset(
    id: string,
    portableId: string,
    mode: KeiCharacterExportMode
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

export async function exportCharacterToKei(
    characterId: string,
    options: ExportCharacterOptions = {}
): Promise<KeiCharacterPackageV1> {
    const mode = options.mode ?? 'light';

    const character = await CharacterService.get(characterId);
    if (!character) {
        throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    }

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(characterId),
        ScriptService.listByOwner(characterId),
        CharJSService.listByOwner(characterId)
    ]);

    const lorebookMap = mapById(
        lorebooks.map((item) => item.id),
        'lorebook'
    );
    const scriptMap = mapById(
        scripts.map((item) => item.id),
        'script'
    );
    const charjsMap = mapById(
        charjs.map((item) => item.id),
        'charjs'
    );

    const assetIds = collectAssetIds(character);
    const assetMap = mapById(assetIds, 'asset');

    const portableCharacter: KeiCharacterPayload = {
        name: character.name,
        description: character.description,
        characterNote: character.characterNote,
        greetings: { ...character.greetings },
        defaultVariables: { ...character.defaultVariables },
        allowLowLevel: character.allowLowLevel,
        ...(character.avatarAssetId ? { avatarAssetId: assetMap[character.avatarAssetId] } : {}),
        lorebooks: exportEntityList(character.lorebooks, lorebookMap, 'lorebook_folder'),
        scripts: exportEntityList(character.scripts, scriptMap, 'script_folder'),
        charjs: exportEntityList(character.charjs, charjsMap, 'charjs_folder'),
        assets: exportEntityList<AssetRef>(character.assets, assetMap, 'asset_folder')
    };

    const assetPayloads = await Promise.all(
        assetIds.map((id) => exportAsset(id, assetMap[id], mode))
    );

    return {
        version: 1,
        kind: 'keiai.character',
        character: portableCharacter,
        lorebooks: lorebooks.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: lorebookMap[id]
            })
        ),
        scripts: scripts.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: scriptMap[id]
            })
        ),
        charjs: charjs.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: charjsMap[id]
            })
        ),
        assets: assetPayloads
    };
}
