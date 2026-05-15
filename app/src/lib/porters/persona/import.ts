import type { DataScopeType } from '$lib/adapters/db';
import { PersonaService } from '$lib/services';
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

export async function importPersonaFromKei(
    pkg: KeiPersonaPackageV1,
    options: ImportPersonaOptions = {}
): Promise<string> {
    assertPackage(pkg);
    const scopeType = options.scopeType ?? 'user';
    const assetMap = await importAssets(pkg.assets, scopeType, options.allowLightAssets ?? true);

    const persona = await PersonaService.create(
        {
            name: pkg.persona.name,
            description: pkg.persona.description,
            assets: { refs: {}, folders: {} }
        },
        scopeType
    );

    await PersonaService.update(persona.id, {
        ...(pkg.persona.avatarAssetId
            ? { avatarAssetId: requireMapped(assetMap, pkg.persona.avatarAssetId) }
            : {}),
        assets: remapEntityList(pkg.persona.assets, assetMap)
    });

    return persona.id;
}
