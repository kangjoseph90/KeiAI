import { CharacterService, CharJSService, LorebookService, ScriptService } from '$lib/services';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiCharacterPackageV1, KeiCharacterPayload } from './types';
import {
    createPortableIdMap,
    exportAsset,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

export type KeiCharacterExportMode = KeiPackageExportMode;

export interface ExportCharacterOptions {
    mode?: KeiCharacterExportMode;
}

function collectAssetIds(character: KeiCharacterPayload): string[] {
    const ids = new Set<string>();
    if (character.avatarAssetId) ids.add(character.avatarAssetId);
    for (const id of Object.keys(character.assets.refs)) {
        ids.add(id);
    }
    return [...ids];
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

    const lorebookMap = createPortableIdMap(
        lorebooks.map((item) => item.id),
        'lorebook'
    );
    const scriptMap = createPortableIdMap(
        scripts.map((item) => item.id),
        'script'
    );
    const charjsMap = createPortableIdMap(
        charjs.map((item) => item.id),
        'charjs'
    );

    const assetIds = collectAssetIds(character);
    const assetMap = createPortableIdMap(assetIds, 'asset');

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
