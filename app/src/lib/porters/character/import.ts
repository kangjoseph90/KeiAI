import type { DataScopeType } from '$lib/adapters/db';
import { CharacterService, CharJSService, LorebookService, ScriptService } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import { AppError } from '$lib/types/errors';
import type { KeiCharacterPackageV1 } from './types';
import { importAssets, remapEntityList, requireMapped } from '../utils';

export interface ImportCharacterOptions {
    scopeType?: DataScopeType;
    allowLightAssets?: boolean;
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
    const assetMap = await importAssets(pkg.assets, scopeType, options.allowLightAssets ?? true);

    let characterId: string | undefined = undefined;
    try {
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
        characterId = character.id;

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
    } catch (error) {
        if (characterId) {
            await CharacterService.delete(characterId).catch(() => undefined);
        }
        await Promise.all(
            Object.values(assetMap).map((id) => AssetService.delete(id).catch(() => undefined))
        );
        throw error;
    }
}
