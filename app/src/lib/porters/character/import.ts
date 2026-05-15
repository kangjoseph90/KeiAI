import type { DataScopeType } from '$lib/adapters/db';
import { CharacterService, CharJSService, LorebookService, ScriptService } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import type { EntityListConfig, FolderDef, OrderedRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { classifyAsset, type KeiCharacterPackageV1 } from './types';

export interface ImportCharacterOptions {
    scopeType?: DataScopeType;
    allowLightAssets?: boolean;
}

function assertPackage(pkg: KeiCharacterPackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.character') {
        throw new AppError('INVALID_INPUT', 'Unsupported character package');
    }
}

function remapFolders(folders: Record<string, FolderDef>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const id of Object.keys(folders)) {
        map[id] = generateId();
    }
    return map;
}

function remapEntityList<R extends OrderedRef>(
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

async function importAssets(
    pkg: KeiCharacterPackageV1,
    scopeType: DataScopeType,
    allowLightAssets: boolean
): Promise<Record<string, string>> {
    const map: Record<string, string> = {};

    for (const asset of pkg.assets) {
        const kind = classifyAsset(asset);
        if (kind === 'broken') {
            throw new AppError('INVALID_INPUT', `Broken asset payload: ${asset.id}`);
        }

        if (kind === 'light') {
            if (!allowLightAssets) {
                throw new AppError('INVALID_INPUT', `Light asset import is disabled: ${asset.id}`);
            }
        }
    }

    for (const asset of pkg.assets) {
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

export async function importCharacterFromKei(
    pkg: KeiCharacterPackageV1,
    options: ImportCharacterOptions = {}
): Promise<string> {
    assertPackage(pkg);
    const scopeType = options.scopeType ?? 'user';
    const assetMap = await importAssets(pkg, scopeType, options.allowLightAssets ?? true);

    const character = await CharacterService.create(
        {
            name: pkg.character.name,
            description: pkg.character.description,
            characterNote: pkg.character.characterNote,
            greetings: { ...pkg.character.greetings },
            defaultVariables: { ...pkg.character.defaultVariables },
            allowLowLevel: pkg.character.allowLowLevel,
            modules: { refs: {}, folders: {} },
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        },
        scopeType
    );

    const lorebookMap: Record<string, string> = {};
    for (const { id, ...fields } of pkg.lorebooks) {
        const lorebook = await LorebookService.create(character.id, fields, scopeType);
        lorebookMap[id] = lorebook.id;
    }

    const scriptMap: Record<string, string> = {};
    for (const { id, ...fields } of pkg.scripts) {
        const script = await ScriptService.create(character.id, fields, scopeType);
        scriptMap[id] = script.id;
    }

    const charjsMap: Record<string, string> = {};
    for (const { id, ...fields } of pkg.charjs) {
        const charjs = await CharJSService.create(character.id, fields, scopeType);
        charjsMap[id] = charjs.id;
    }

    await CharacterService.update(character.id, {
        ...(pkg.character.avatarAssetId
            ? { avatarAssetId: requireMapped(assetMap, pkg.character.avatarAssetId) }
            : {}),
        lorebooks: remapEntityList(pkg.character.lorebooks, lorebookMap),
        scripts: remapEntityList(pkg.character.scripts, scriptMap),
        charjs: remapEntityList(pkg.character.charjs, charjsMap),
        assets: remapEntityList(pkg.character.assets, assetMap)
    });

    return character.id;
}

function requireMapped(map: Record<string, string>, id: string): string {
    const mapped = map[id];
    if (!mapped) {
        throw new AppError('INVALID_INPUT', `Missing package payload: ${id}`);
    }
    return mapped;
}
