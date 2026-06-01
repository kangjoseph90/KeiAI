import { CharJSService, LorebookService, ModuleService, ScriptService } from '$lib/services';
import type { AssetOwner } from '$lib/adapters/asset';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import { getSessionScope } from '$lib/services/session';
import type { KeiModulePackageV1 } from './types';
import {
    createPortableIdMap,
    exportAssetPayload,
    exportEntityList,
    type KeiPackageExportMode
} from '../utils';

export async function exportModulePackage(
    moduleId: string,
    assetMode: KeiPackageExportMode
): Promise<KeiModulePackageV1> {
    const module = await ModuleService.get(moduleId);
    if (!module) {
        throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
    }

    const [lorebooks, scripts, charjs] = await Promise.all([
        LorebookService.listByOwner(moduleId),
        ScriptService.listByOwner(moduleId),
        CharJSService.listByOwner(moduleId)
    ]);

    const scope = getSessionScope('user');
    const owner: AssetOwner = {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        ownerTable: 'modules',
        ownerId: module.id
    };

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

    const layoutIds = Object.keys(module.assets.refs);
    const assetMap = createPortableIdMap(layoutIds, 'asset');

    const portableModule = {
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

    // Export list asset blobs
    const assets: Record<string, { data?: Uint8Array; hash?: string; encKey?: string }> = {};
    for (const [layoutId, ref] of Object.entries(module.assets.refs)) {
        const portableId = assetMap[layoutId];
        if (!portableId) continue;
        assets[portableId] = await exportAssetPayload(ref, owner, assetMode);
    }

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
        assets
    };
}
