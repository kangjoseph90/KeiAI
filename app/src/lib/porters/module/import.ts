import { ModuleService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiModulePackageV1 } from './types';
import type { PorterProgressReporter } from '../progress';
import {
    importAssetPayloads,
    importEntityList,
    materializeImportedAsset,
    remapImportedAssetFolders
} from '../utils';

export interface ImportModuleOptions {
    allowLightAssets?: boolean;
    onProgress?: PorterProgressReporter;
}

function assertPackage(pkg: KeiModulePackageV1): void {
    if (pkg.version !== 1 || pkg.kind !== 'keiai.module') {
        throw new AppError('INVALID_INPUT', 'Unsupported module package');
    }
}

export async function importModulePackage(
    pkg: KeiModulePackageV1,
    options: ImportModuleOptions = {}
): Promise<string> {
    assertPackage(pkg);
    const { onProgress } = options;

    let moduleId: string | undefined = undefined;
    try {
        onProgress?.({ phase: 'processing-data', completed: 0, total: 0 });
        const module = await ModuleService.create({
            name: pkg.module.name,
            description: pkg.module.description,
            backgroundHTML: pkg.module.backgroundHTML ?? '',
            messageCSS: pkg.module.messageCSS ?? '',
            defaultVariables: { ...(pkg.module.defaultVariables ?? {}) },
            toggles: structuredClone(pkg.module.toggles),
            commands: structuredClone(pkg.module.commands),
            allowLowLevel: pkg.module.allowLowLevel,
            lorebooks: importEntityList(pkg.module.lorebooks),
            scripts: importEntityList(pkg.module.scripts),
            charjs: importEntityList(pkg.module.charjs),
            assets: { refs: {}, folders: {} }
        });
        moduleId = module.id;

        const assetInputs = importAssetPayloads(pkg.assets, options.allowLightAssets ?? true);

        const assetEntries = Object.entries(pkg.module.assets.refs).filter(
            ([portableKey]) => assetInputs[portableKey]
        );
        const total = assetEntries.length;
        let completed = 0;
        onProgress?.({ phase: 'processing-assets', completed, total });

        const layoutIdMap: Record<string, string> = {};
        const knownAssetIds = new Set<string>();
        for (const [portableKey, pkgRef] of assetEntries) {
            const imported = assetInputs[portableKey];
            if (!imported) continue;

            const updated = await ModuleService.createAsset(
                module.id,
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
        const current = await ModuleService.get(module.id);
        if (current) {
            const fixed = remapImportedAssetFolders({
                currentRefs: current.assets.refs,
                layoutIdMap,
                pkgRefs: pkg.module.assets.refs,
                pkgFolders: pkg.module.assets.folders
            });
            if (fixed) {
                await ModuleService.update(module.id, { assets: fixed });
            }
        }

        return module.id;
    } catch (error) {
        if (moduleId) {
            await ModuleService.delete(moduleId).catch(() => undefined);
        }
        throw error;
    }
}
