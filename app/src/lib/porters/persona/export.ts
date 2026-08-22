import { PersonaService } from '$lib/services';
import type { AssetOwner } from '$lib/adapters/asset';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiPersonaPackageV1 } from './types';
import type { PorterProgressReporter } from '../progress';
import {
    createPortableIdMap,
    exportAssetPayload,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

export async function exportPersonaPackage(
    personaId: string,
    assetMode: KeiPackageExportMode,
    onProgress?: PorterProgressReporter
): Promise<KeiPersonaPackageV1> {
    onProgress?.({ phase: 'preparing', completed: 0, total: 0 });
    const persona = await PersonaService.get(personaId);
    if (!persona) {
        throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    }

    const owner: AssetOwner = {
        scopeType: persona.scopeType,
        scopeId: persona.scopeId,
        ownerTable: 'personas',
        ownerId: persona.id
    };

    const layoutIds = Object.keys(persona.assets.refs);
    const assetMap = createPortableIdMap(layoutIds, 'asset');

    const portablePersona = {
        name: persona.name,
        description: persona.description,
        avatar: persona.avatar,
        assets: exportEntityList<AssetRef>(persona.assets, assetMap, 'asset_folder')
    };

    // Export list asset blobs
    const assets: Record<string, { data?: Uint8Array; hash?: string; encKey?: string }> = {};
    const assetEntries = Object.entries(persona.assets.refs);
    const total = assetEntries.length + (persona.avatar ? 1 : 0);
    let completed = 0;
    onProgress?.({ phase: 'processing-assets', completed, total });
    for (const [layoutId, ref] of assetEntries) {
        const portableId = assetMap[layoutId];
        if (!portableId) continue;
        assets[portableId] = await exportAssetPayload(ref, owner, assetMode);
        completed += 1;
        onProgress?.({ phase: 'processing-assets', completed, total });
    }

    // Export avatar blob separately
    let avatar: { data?: Uint8Array; hash?: string; encKey?: string } | undefined;
    if (persona.avatar) {
        avatar = await exportAssetPayload(persona.avatar, owner, assetMode);
        completed += 1;
        onProgress?.({ phase: 'processing-assets', completed, total });
    }

    return {
        version: 1,
        kind: 'keiai.persona',
        persona: portablePersona,
        assets,
        avatar
    };
}
