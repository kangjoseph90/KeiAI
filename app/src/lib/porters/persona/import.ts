import type { DataScopeType } from '$lib/adapters/db';
import { PersonaService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiPersonaPackageV1 } from './types';
import type { PorterProgressReporter } from '../progress';
import {
    importAssetPayload,
    importAssetPayloads,
    materializeImportedAsset,
    remapImportedAssetFolders
} from '../utils';

export interface ImportPersonaOptions {
    scopeType?: DataScopeType;
    allowLightAssets?: boolean;
    onProgress?: PorterProgressReporter;
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
    const { onProgress } = options;

    let personaId: string | undefined = undefined;
    try {
        onProgress?.({ phase: 'processing-data', completed: 0, total: 0 });
        const persona = await PersonaService.create(
            {
                name: pkg.persona.name,
                description: pkg.persona.description,
                assets: { refs: {}, folders: {} }
            },
            scopeType
        );
        personaId = persona.id;

        const assetInputs = importAssetPayloads(pkg.assets, options.allowLightAssets ?? true);

        const assetEntries = Object.entries(pkg.persona.assets.refs).filter(
            ([portableKey]) => assetInputs[portableKey]
        );
        const total = assetEntries.length + (pkg.avatar ? 1 : 0);
        let completed = 0;
        onProgress?.({ phase: 'processing-assets', completed, total });

        if (pkg.avatar) {
            const avatarInput = materializeImportedAsset(
                importAssetPayload('avatar', pkg.avatar, options.allowLightAssets ?? true),
                {
                    name: 'avatar.bin',
                    mimeType: pkg.persona.avatar?.mimeType ?? 'application/octet-stream',
                    width: pkg.persona.avatar?.width,
                    height: pkg.persona.avatar?.height
                }
            );
            await PersonaService.updateAvatar(persona.id, avatarInput);
            completed += 1;
            onProgress?.({ phase: 'processing-assets', completed, total });
        }

        const layoutIdMap: Record<string, string> = {};
        const knownAssetIds = new Set<string>();
        for (const [portableKey, pkgRef] of assetEntries) {
            const imported = assetInputs[portableKey];
            if (!imported) continue;

            const updated = await PersonaService.createAsset(
                persona.id,
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
        const current = await PersonaService.get(persona.id);
        if (current) {
            const fixed = remapImportedAssetFolders({
                currentRefs: current.assets.refs,
                layoutIdMap,
                pkgRefs: pkg.persona.assets.refs,
                pkgFolders: pkg.persona.assets.folders
            });
            if (fixed) {
                await PersonaService.update(persona.id, { assets: fixed });
            }
        }

        return persona.id;
    } catch (error) {
        if (personaId) {
            await PersonaService.delete(personaId).catch(() => undefined);
        }
        throw error;
    }
}
