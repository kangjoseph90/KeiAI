import { CharacterService } from '$lib/services';
import type { AssetOwner } from '$lib/adapters/asset';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiCharacterPackageV1, KeiCharacterPayload } from './types';
import type { PorterProgressReporter } from '../progress';
import { exportAssetPayload, exportEntityList, type KeiPackageExportMode } from '../utils';

export type CharacterCardV3Format = 'png' | 'charx';
export type CharacterFileExport =
    | { kind: 'ccv3'; format: CharacterCardV3Format }
    | { kind: 'keichar'; assetMode: KeiPackageExportMode };

export async function exportCharacterPackage(
    characterId: string,
    assetMode: KeiPackageExportMode,
    onProgress?: PorterProgressReporter
): Promise<KeiCharacterPackageV1> {
    onProgress?.({ phase: 'preparing', completed: 0, total: 0 });
    const character = await CharacterService.get(characterId);
    if (!character) {
        throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    }

    const owner: AssetOwner = {
        scopeType: character.scopeType,
        scopeId: character.scopeId,
        ownerTable: 'characters',
        ownerId: character.id
    };

    // Asset layoutId mapping for EntityListConfig
    const layoutIds = Object.keys(character.assets.refs);
    const assetMap = Object.fromEntries(layoutIds.map((id, index) => [id, `asset_${index}`]));

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
        lorebooks: structuredClone(character.lorebooks),
        scripts: structuredClone(character.scripts),
        charjs: structuredClone(character.charjs),
        assets: exportEntityList<AssetRef>(character.assets, assetMap, 'asset_folder')
    };

    // Export list asset blobs keyed by portable layoutId
    const assets = new Map<string, { data?: Uint8Array; hash?: string; encKey?: string }>();
    const assetEntries = Object.entries(character.assets.refs);
    const total = assetEntries.length + (character.avatar ? 1 : 0);
    let completed = 0;
    onProgress?.({ phase: 'processing-assets', completed, total });
    for (const [layoutId, ref] of assetEntries) {
        const portableId = assetMap[layoutId];
        if (!portableId) continue;
        assets.set(portableId, await exportAssetPayload(ref, owner, assetMode));
        completed += 1;
        onProgress?.({ phase: 'processing-assets', completed, total });
    }

    // Export avatar blob separately
    let avatar: { data?: Uint8Array; hash?: string; encKey?: string } | undefined;
    if (character.avatar) {
        avatar = await exportAssetPayload(character.avatar, owner, assetMode);
        completed += 1;
        onProgress?.({ phase: 'processing-assets', completed, total });
    }

    return {
        version: 1,
        kind: 'keiai.character',
        character: portableCharacter,
        assets: Object.fromEntries(assets.entries()),
        avatar
    };
}
