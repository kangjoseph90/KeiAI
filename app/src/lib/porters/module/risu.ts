import {
    readRisuModule,
    writeRisuModule,
    type RisuModule as RawRisuModule,
    type RisuModuleAsset
} from '../risu/module';
import { keiLorebookToRisuInternal, risuInternalLorebookToKei } from '../risu/lorebook';
import { keiScriptToRisu, risuScriptToKei } from '../risu/script';
import { denormalizeRisuTemplate, normalizeRisuTemplate } from '../risu/template';
import { backgroundWithMessageCSS, extractStyleCSS } from '../risu/background';
import type { KeiModulePackageV1 } from './types';
import { refs, sortOrder } from '../utils';
import { readRisuTogglePanel, writeRisuTogglePanel } from '../risu/toggle';
import { listItems } from '$lib/utils/ordering';

type FullRisuModule = RawRisuModule & {
    lowLevelAccess?: boolean;
    assets?: RisuModuleAsset[];
    namespace?: string;
    customModuleToggle?: string;
    backgroundEmbedding?: string;
};

export function readRisuModulePackage(bytes: Uint8Array): KeiModulePackageV1 {
    return risuModuleToKeiPackage(readRisuModule(bytes));
}

export function writeRisuModulePackage(pkg: KeiModulePackageV1): Uint8Array {
    return writeRisuModule(keiPackageToRisuModule(pkg));
}

export function risuModuleToKeiPackage(risu: FullRisuModule): KeiModulePackageV1 {
    const lorebooks = (risu.lorebook ?? []).map(risuInternalLorebookToKei);
    const scripts = (risu.regex ?? []).map(risuScriptToKei);
    const assets = (risu.assets ?? []).map((asset, index) => ({
        id: `asset_${index}`,
        name: asset[0] || `Asset ${index + 1}`,
        extension: asset[2] || extensionFromName(asset[1])
    }));
    const assetData = risu.assetData ?? [];

    return {
        version: 1,
        kind: 'keiai.module',
        module: {
            name: risu.name ?? 'Imported Risu Module',
            description: normalizeRisuTemplate(risu.description ?? ''),
            backgroundHTML: normalizeRisuTemplate(risu.backgroundEmbedding ?? ''),
            messageCSS: extractStyleCSS(normalizeRisuTemplate(risu.backgroundEmbedding ?? '')),
            defaultVariables: {},
            toggles: readRisuTogglePanel(risu.customModuleToggle ?? ''),
            commands: { refs: {}, folders: {} },
            allowLowLevel: risu.lowLevelAccess ?? false,
            lorebooks: refs(lorebooks),
            scripts: refs(scripts),
            charjs: { refs: {}, folders: {} },
            assets: {
                refs: Object.fromEntries(
                    assets.map((asset, index) => [
                        asset.id,
                        {
                            id: asset.id,
                            name: asset.name,
                            sortOrder: sortOrder(index),
                            hash: '',
                            encKey: '',
                            mimeType: ''
                        }
                    ])
                ),
                folders: {}
            }
        },
        assets: Object.fromEntries(
            assets.map((asset, index) => [
                asset.id,
                assetData[index] ? { data: assetData[index] } : {}
            ])
        )
    };
}

export function keiPackageToRisuModule(pkg: KeiModulePackageV1): FullRisuModule {
    return {
        name: pkg.module.name,
        description: denormalizeRisuTemplate(pkg.module.description),
        backgroundEmbedding: denormalizeRisuTemplate(
            backgroundWithMessageCSS(pkg.module.backgroundHTML, pkg.module.messageCSS)
        ),
        lowLevelAccess: pkg.module.allowLowLevel,
        customModuleToggle: writeRisuTogglePanel(pkg.module.toggles),
        id: 'keiai',
        lorebook: listItems(pkg.module.lorebooks).map(keiLorebookToRisuInternal),
        regex: listItems(pkg.module.scripts).map(keiScriptToRisu),
        assets: Object.entries(pkg.assets).map(([key, asset]) => [
            pkg.module.assets.refs[key]?.name ?? key,
            '',
            extensionFromName(pkg.module.assets.refs[key]?.name ?? key)
        ]),
        assetData: Object.values(pkg.assets).map((asset) => asset.data ?? new Uint8Array())
    };
}

function extensionFromName(value: string): string {
    const match = /\.([a-z0-9]+)$/i.exec(value);
    return match?.[1] ?? 'webp';
}
