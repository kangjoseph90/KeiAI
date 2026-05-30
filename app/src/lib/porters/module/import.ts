import { CharJSService, LorebookService, ModuleService, ScriptService } from '$lib/services';
import { AssetService } from '$lib/services/asset';
import { AppError } from '$lib/types/errors';
import type { KeiModulePackageV1 } from './types';
import { importAssets, remapEntityList } from '../utils';

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
    const assetMap = await importAssets(pkg.assets, 'user', options.allowLightAssets ?? true);

    let moduleId: string | undefined = undefined;
    try {
        const module = await ModuleService.create({
            name: pkg.module.name,
            description: pkg.module.description,
            backgroundHTML: pkg.module.backgroundHTML ?? '',
            messageCSS: pkg.module.messageCSS ?? '',
            allowLowLevel: pkg.module.allowLowLevel,
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        moduleId = module.id;

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

        await ModuleService.update(module.id, {
            lorebooks: remapEntityList(pkg.module.lorebooks, lorebookMap),
            scripts: remapEntityList(pkg.module.scripts, scriptMap),
            charjs: remapEntityList(pkg.module.charjs, charjsMap),
            assets: remapEntityList(pkg.module.assets, assetMap)
        });

        return module.id;
    } catch (error) {
        if (moduleId) {
            await ModuleService.delete(moduleId).catch(() => undefined);
        }
        await Promise.all(
            Object.values(assetMap).map((id) => AssetService.delete(id).catch(() => undefined))
        );
        throw error;
    }
}
