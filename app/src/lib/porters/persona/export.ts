import { PersonaService } from '$lib/services';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiPersonaPackageV1, KeiPersonaPayload } from './types';
import {
    createPortableIdMap,
    exportAsset,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

function collectAssetIds(persona: KeiPersonaPayload): string[] {
    const ids = new Set<string>();
    if (persona.avatarAssetId) ids.add(persona.avatarAssetId);
    for (const id of Object.keys(persona.assets.refs)) {
        ids.add(id);
    }
    return [...ids];
}

export async function exportPersonaPackage(
    personaId: string,
    assetMode: KeiPackageExportMode
): Promise<KeiPersonaPackageV1> {
    const persona = await PersonaService.get(personaId);
    if (!persona) {
        throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    }

    const assetIds = collectAssetIds(persona);
    const assetMap = createPortableIdMap(assetIds, 'asset');

    const portablePersona: KeiPersonaPayload = {
        name: persona.name,
        description: persona.description,
        ...(persona.avatarAssetId ? { avatarAssetId: assetMap[persona.avatarAssetId] } : {}),
        assets: exportEntityList<AssetRef>(persona.assets, assetMap, 'asset_folder')
    };

    const assetPayloads = await Promise.all(
        assetIds.map((id) => exportAsset(id, assetMap[id], assetMode))
    );

    return {
        version: 1,
        kind: 'keiai.persona',
        persona: portablePersona,
        assets: assetPayloads
    };
}
