import { CharJSService, LorebookService, ModuleService, ScriptService } from '$lib/services';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import type { KeiModulePackageV1, KeiModulePayload } from './types';
import {
    createPortableIdMap,
    exportAsset,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

export type KeiModuleExportMode = KeiPackageExportMode;

export interface ExportModuleOptions {
    mode?: KeiModuleExportMode;
}

function collectAssetIds(module: KeiModulePayload): string[] {
    const ids = new Set<string>();
    for (const id of Object.keys(module.assets.refs)) {
        ids.add(id);
    }
    return [...ids];
}

export async function exportModuleToKei(
    moduleId: string,
    options: ExportModuleOptions = {}
): Promise<KeiModulePackageV1> {
    const mode = options.mode ?? 'light';

    const module = await ModuleService.get(moduleId);
    if (!module) {
        throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
    }

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(moduleId),
        ScriptService.listByOwner(moduleId),
        CharJSService.listByOwner(moduleId)
    ]);

    const lorebookMap = createPortableIdMap(
        lorebooks.map((item) => item.id),
        'lorebook'
    );
    const scriptMap = createPortableIdMap(
        scripts.map((item) => item.id),
        'script'
    );
    const charjsMap = createPortableIdMap(
        charjs.map((item) => item.id),
        'charjs'
    );

    const assetIds = collectAssetIds(module);
    const assetMap = createPortableIdMap(assetIds, 'asset');

    const portableModule: KeiModulePayload = {
        name: module.name,
        description: module.description,
        backgroundHTML: module.backgroundHTML,
        messageCSS: module.messageCSS,
        allowLowLevel: module.allowLowLevel,
        lorebooks: exportEntityList(module.lorebooks, lorebookMap, 'lorebook_folder'),
        scripts: exportEntityList(module.scripts, scriptMap, 'script_folder'),
        charjs: exportEntityList(module.charjs, charjsMap, 'charjs_folder'),
        assets: exportEntityList<AssetRef>(module.assets, assetMap, 'asset_folder')
    };

    const assetPayloads = await Promise.all(
        assetIds.map((id) => exportAsset(id, assetMap[id], mode))
    );

    return {
        version: 1,
        kind: 'keiai.module',
        module: portableModule,
        lorebooks: lorebooks.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: lorebookMap[id]
            })
        ),
        scripts: scripts.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: scriptMap[id]
            })
        ),
        charjs: charjs.map(
            ({ id, ownerId: _ownerId, scopeType: _scopeType, scopeId: _scopeId, ...fields }) => ({
                ...fields,
                id: charjsMap[id]
            })
        ),
        assets: assetPayloads
    };
}
