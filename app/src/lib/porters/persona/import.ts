import type { DataScopeType } from '$lib/adapters/db';
import { PersonaService } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import { AppError } from '$lib/types/errors';
import type { KeiPersonaPackageV1 } from './types';
import { importAssets, remapEntityList, requireMapped } from '../utils';

export interface ImportPersonaOptions {
    scopeType?: DataScopeType;
    allowLightAssets?: boolean;
}

function assertPackage(pkg: KeiPersonaPackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.persona') {
        throw new AppError('INVALID_INPUT', 'Unsupported persona package');
    }
}

export async function importPersonaPackage(
    pkg: KeiPersonaPackageV1,
    options: ImportPersonaOptions = {}
): Promise<string> {
    assertPackage(pkg);
    const scopeType = options.scopeType ?? 'user';
    const assetMap = await importAssets(pkg.assets, scopeType, options.allowLightAssets ?? true);

    let personaId: string | undefined = undefined;
    try {
        const persona = await PersonaService.create(
            {
                name: pkg.persona.name,
                description: pkg.persona.description,
                assets: { refs: {}, folders: {} }
            },
            scopeType
        );
        personaId = persona.id;

        await PersonaService.update(persona.id, {
            ...(pkg.persona.avatarAssetId
                ? { avatarAssetId: requireMapped(assetMap, pkg.persona.avatarAssetId) }
                : {}),
            assets: remapEntityList(pkg.persona.assets, assetMap)
        });

        return persona.id;
    } catch (error) {
        if (personaId) {
            await PersonaService.delete(personaId).catch(() => undefined);
        }
        await Promise.all(
            Object.values(assetMap).map((id) => AssetService.delete(id).catch(() => undefined))
        );
        throw error;
    }
}
