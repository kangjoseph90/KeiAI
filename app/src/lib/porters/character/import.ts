import type { DataScopeType } from '$lib/adapters/db';
import { CharacterService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiCharacterPackageV1 } from './types';
import type { PorterProgressReporter } from '../progress';
import {
    importAssetPayload,
    importAssetPayloads,
    importEntityList,
    materializeImportedAsset,
    remapImportedAssetFolders
} from '../utils';

export interface ImportCharacterOptions {
    scopeType?: DataScopeType;
    allowLightAssets?: boolean;
    onProgress?: PorterProgressReporter;
}

function assertPackage(pkg: KeiCharacterPackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.character') {
        throw new AppError('INVALID_INPUT', 'Unsupported character package');
    }
}

export async function importCharacterPackage(
    pkg: KeiCharacterPackageV1,
    options: ImportCharacterOptions = {}
): Promise<string> {
    assertPackage(pkg);
    const scopeType = options.scopeType ?? 'user';
    const { onProgress } = options;

    let characterId: string | undefined = undefined;
    try {
        onProgress?.({ phase: 'processing-data', completed: 0, total: 0 });
        const character = await CharacterService.create(
            {
                name: pkg.character.name,
                description: pkg.character.description,
                characterNote: pkg.character.characterNote,
                backgroundHTML: pkg.character.backgroundHTML ?? '',
                messageCSS: pkg.character.messageCSS ?? '',
                greetings: pkg.character.greetings,
                defaultVariables: pkg.character.defaultVariables,
                allowLowLevel: pkg.character.allowLowLevel,
                lorebooks: importEntityList(pkg.character.lorebooks),
                scripts: importEntityList(pkg.character.scripts),
                charjs: importEntityList(pkg.character.charjs),
                assets: { refs: {}, folders: {} }
            },
            scopeType
        );
        characterId = character.id;

        const assetInputs = importAssetPayloads(pkg.assets, options.allowLightAssets ?? true);

        const assetEntries = Object.entries(pkg.character.assets.refs).filter(
            ([portableKey]) => assetInputs[portableKey]
        );
        const total = assetEntries.length + (pkg.avatar ? 1 : 0);
        let completed = 0;
        onProgress?.({ phase: 'processing-assets', completed, total });

        if (pkg.avatar) {
            const avatarInput = materializeImportedAsset(
                importAssetPayload('avatar', pkg.avatar, options.allowLightAssets ?? true),
                {
                    name: pkg.character.avatar?.name ?? 'avatar.bin',
                    mimeType: pkg.character.avatar?.mimeType ?? 'application/octet-stream',
                    width: pkg.character.avatar?.width,
                    height: pkg.character.avatar?.height
                }
            );
            await CharacterService.updateAvatar(character.id, avatarInput);
            completed += 1;
            onProgress?.({ phase: 'processing-assets', completed, total });
        }

        const layoutIdMap: Record<string, string> = {};
        const knownAssetIds = new Set<string>();
        for (const [portableKey, pkgRef] of assetEntries) {
            const imported = assetInputs[portableKey];
            if (!imported) continue;

            const updated = await CharacterService.createAsset(
                character.id,
                materializeImportedAsset(imported, {
                    name: pkgRef.name,
                    mimeType: pkgRef.mimeType,
                    width: pkgRef.width,
                    height: pkgRef.height
                }),
                pkgRef.sortOrder
            );

            const newId = Object.keys(updated.assets.refs).find((id) => !knownAssetIds.has(id));
            if (newId) {
                knownAssetIds.add(newId);
                layoutIdMap[portableKey] = newId;
            }
            completed += 1;
            onProgress?.({ phase: 'processing-assets', completed, total });
        }

        onProgress?.({ phase: 'finalizing', completed, total });
        const current = await CharacterService.get(character.id);
        if (current) {
            const fixed = remapImportedAssetFolders({
                currentRefs: current.assets.refs,
                layoutIdMap,
                pkgRefs: pkg.character.assets.refs,
                pkgFolders: pkg.character.assets.folders
            });
            if (fixed) {
                await CharacterService.update(character.id, { assets: fixed });
            }
        }

        return character.id;
    } catch (error) {
        if (characterId) {
            await CharacterService.delete(characterId).catch(() => undefined);
        }
        throw error;
    }
}
