import { ModuleService } from '$lib/services';
import type { AssetOwner } from '$lib/adapters/asset';
import type { AssetRef } from '$lib/types/refs';
import { AppError } from '$lib/types/errors';
import { getSessionScope } from '$lib/services/session';
import type { KeiModulePackageV1 } from './types';
import { exportAssetPayload, exportEntityList, type KeiPackageExportMode } from '../utils';

export async function exportModulePackage(
    moduleId: string,
    assetMode: KeiPackageExportMode
): Promise<KeiModulePackageV1> {
    const module = await ModuleService.get(moduleId);
    if (!module) {
        throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
    }

    const scope = getSessionScope('user');
    const owner: AssetOwner = {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        ownerTable: 'modules',
        ownerId: module.id
    };

    const layoutIds = Object.keys(module.assets.refs);
    const assetMap = Object.fromEntries(layoutIds.map((id, index) => [id, `asset_${index}`]));

    const portableModule = {
        name: module.name,
        description: module.description,
        backgroundHTML: module.backgroundHTML,
        messageCSS: module.messageCSS,
        defaultVariables: { ...module.defaultVariables },
        toggles: structuredClone(module.toggles),
        allowLowLevel: module.allowLowLevel,
        lorebooks: structuredClone(module.lorebooks),
        scripts: structuredClone(module.scripts),
        charjs: structuredClone(module.charjs),
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
        assets
    };
}
