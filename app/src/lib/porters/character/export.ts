import { CharacterService, CharJSService, LorebookService, ScriptService } from '$lib/services';
import type { AssetOwner } from '$lib/adapters/asset';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiCharacterPackageV1, KeiCharacterPayload } from './types';
import {
    createPortableIdMap,
    exportAssetPayload,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

export type CharacterCardV3Format = 'png' | 'charx';
export type CharacterFileExport =
    | { kind: 'ccv3'; format: CharacterCardV3Format }
    | { kind: 'keichar'; assetMode: KeiPackageExportMode };

export async function exportCharacterPackage(
    characterId: string,
    assetMode: KeiPackageExportMode
): Promise<KeiCharacterPackageV1> {
    const character = await CharacterService.get(characterId);
    if (!character) {
        throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    }

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(characterId),
        ScriptService.listByOwner(characterId),
        CharJSService.listByOwner(characterId)
    ]);

    const owner: AssetOwner = {
        scopeType: character.scopeType,
        scopeId: character.scopeId,
        ownerTable: 'characters',
        ownerId: character.id
    };

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

    // Asset layoutId mapping for EntityListConfig
    const layoutIds = Object.keys(character.assets.refs);
    const assetMap = createPortableIdMap(layoutIds, 'asset');

    const portableCharacter: KeiCharacterPayload = {
        name: character.name,
        description: character.description,
        characterNote: character.characterNote,
        backgroundHTML: character.backgroundHTML,
        messageCSS: character.messageCSS,
        greetings: { ...character.greetings },
        defaultVariables: { ...character.defaultVariables },
        allowLowLevel: character.allowLowLevel,
        avatar: character.avatar,
        lorebooks: exportEntityList(character.lorebooks, lorebookMap, 'lorebook_folder'),
        scripts: exportEntityList(character.scripts, scriptMap, 'script_folder'),
        charjs: exportEntityList(character.charjs, charjsMap, 'charjs_folder'),
        assets: exportEntityList<AssetRef>(character.assets, assetMap, 'asset_folder')
    };

    // Export list asset blobs keyed by portable layoutId
    const assets = new Map<string, { data?: Uint8Array; hash?: string; encKey?: string }>();
    for (const [layoutId, ref] of Object.entries(character.assets.refs)) {
        const portableId = assetMap[layoutId];
        if (!portableId) continue;
        assets.set(portableId, await exportAssetPayload(ref, owner, assetMode));
    }

    // Export avatar blob separately
    let avatar: { data?: Uint8Array; hash?: string; encKey?: string } | undefined;
    if (character.avatar) {
        avatar = await exportAssetPayload(character.avatar, owner, assetMode);
    }

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
        assets: Object.fromEntries(assets.entries()),
        avatar
    };
}
