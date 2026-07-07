import { CharJSService, LorebookService, ModuleService, ScriptService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { KeiModulePackageV1 } from './types';
import {
    importAssetPayloads,
    materializeImportedAsset,
    remapEntityList,
    remapImportedAssetFolders
} from '../utils';

export interface ImportModuleOptions {
    allowLightAssets?: boolean;
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

    let moduleId: string | undefined = undefined;
    try {
        const module = await ModuleService.create({
            name: pkg.module.name,
            description: pkg.module.description,
            backgroundHTML: pkg.module.backgroundHTML ?? '',
            messageCSS: pkg.module.messageCSS ?? '',
            defaultVariables: { ...(pkg.module.defaultVariables ?? {}) },
            allowLowLevel: pkg.module.allowLowLevel,
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        moduleId = module.id;

        const assetInputs = importAssetPayloads(pkg.assets, options.allowLightAssets ?? true);

        const lorebookMap: Record<string, string> = {};
        for (const { id, ...fields } of pkg.lorebooks) {
            const lorebook = await LorebookService.create(module.id, fields);
            lorebookMap[id] = lorebook.id;
        }

        const scriptMap: Record<string, string> = {};
        for (const { id, ...fields } of pkg.scripts) {
            const script = await ScriptService.create(module.id, fields);
            scriptMap[id] = script.id;
        }

        const charjsMap: Record<string, string> = {};
        for (const { id, ...fields } of pkg.charjs) {
            const charjs = await CharJSService.create(module.id, fields);
            charjsMap[id] = charjs.id;
        }

        const layoutIdMap: Record<string, string> = {};
        const knownAssetIds = new Set<string>();
        for (const [portableKey, pkgRef] of Object.entries(pkg.module.assets.refs)) {
            const imported = assetInputs[portableKey];
            if (!imported) continue;

            const updated = await ModuleService.createAsset(
                module.id,
                materializeImportedAsset(imported, {
                    name: pkgRef.name,
                    mimeType: pkgRef.mimeType
                }),
                pkgRef.sortOrder
            );

            const newId = Object.keys(updated.assets.refs).find((id) => !knownAssetIds.has(id));
            if (newId) {
                knownAssetIds.add(newId);
                layoutIdMap[portableKey] = newId;
            }
        }

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

        await ModuleService.update(module.id, {
            lorebooks: remapEntityList(pkg.module.lorebooks, lorebookMap),
            scripts: remapEntityList(pkg.module.scripts, scriptMap),
            charjs: remapEntityList(pkg.module.charjs, charjsMap)
        });

        return module.id;
    } catch (error) {
        if (moduleId) {
            await ModuleService.delete(moduleId).catch(() => undefined);
        }
        throw error;
    }
}
