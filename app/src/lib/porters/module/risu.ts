import type { LorebookFields, ScriptFields } from '$lib/services';
import type { EntityListConfig } from '$lib/types/refs';
import { addRisuLorebookDecorators, readRisuLorebookDecorators } from '../character/lorebook';
import {
    readRisuModule,
    writeRisuModule,
    type RisuInternalLorebook,
    type RisuModule as RawRisuModule,
    type RisuModuleAsset
} from '../character/module';
import type { RisuRegexScript } from '../character/ccv3';
import type { KeiLorebookPayload, KeiModulePackageV1, KeiScriptPayload } from './types';

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
    const lorebooks = (risu.lorebook ?? []).map(risuLorebookToKei);
    const scripts = (risu.regex ?? []).map(risuScriptToKei);
    const assets = (risu.assets ?? []).map((asset, index) => ({
        id: `asset_${index}`,
        name: asset[0] || `Asset ${index + 1}`,
        extension: asset[2] || extensionFromPath(asset[1])
    }));
    const assetData = risu.assetData ?? [];

    return {
        version: 1,
        kind: 'keiai.module',
        module: {
            name: risu.name ?? 'Imported Risu Module',
            description: risu.description ?? '',
            allowLowLevel: risu.lowLevelAccess ?? false,
            lorebooks: refs(lorebooks),
            scripts: refs(scripts),
            charjs: { refs: {}, folders: {} },
            assets: {
                refs: Object.fromEntries(
                    assets.map((asset, index) => [
                        asset.id,
                        { id: asset.id, name: asset.name, sortOrder: sortOrder(index) }
                    ])
                ),
                folders: {}
            }
        },
        lorebooks,
        scripts,
        charjs: [],
        assets: assets.map((asset, index) => ({
            id: asset.id,
            ...(assetData[index] ? { data: assetData[index] } : {})
        }))
    };
}

export function keiPackageToRisuModule(pkg: KeiModulePackageV1): FullRisuModule {
    return {
        name: pkg.module.name,
        description: pkg.module.description,
        lowLevelAccess: pkg.module.allowLowLevel,
        id: 'keiai',
        lorebook: pkg.lorebooks.map(keiLorebookToRisu),
        regex: pkg.scripts.map(keiScriptToRisu),
        assets: pkg.assets.map((asset) => [
            pkg.module.assets.refs[asset.id]?.name ?? asset.id,
            '',
            extensionFromName(pkg.module.assets.refs[asset.id]?.name ?? asset.id)
        ]),
        assetData: pkg.assets.map((asset) => asset.data ?? new Uint8Array())
    };
}

function risuLorebookToKei(lorebook: RisuInternalLorebook, index: number): KeiLorebookPayload {
    const fields: LorebookFields = {
        name: lorebook.comment ?? `Lorebook ${index + 1}`,
        key: lorebook.key ?? '',
        secondKey: lorebook.secondkey ?? '',
        content: lorebook.content ?? '',
        depth: 0,
        order: lorebook.insertorder ?? index,
        alwaysActive: lorebook.alwaysActive ?? false,
        disabled: false,
        role: 'system',
        useRegex: lorebook.useRegex ?? false,
        useMultipleKeys: lorebook.selective ?? false,
        probability: 100,
        recursive: false,
        noRecursiveSearch: false
    };
    return { id: `lorebook_${index}`, ...readRisuLorebookDecorators(fields) };
}

function keiLorebookToRisu(lorebook: KeiLorebookPayload): RisuInternalLorebook {
    return {
        key: lorebook.key,
        secondkey: lorebook.secondKey,
        insertorder: lorebook.order,
        comment: lorebook.name,
        content: addRisuLorebookDecorators(lorebook),
        mode: lorebook.alwaysActive ? 'constant' : lorebook.useMultipleKeys ? 'multiple' : 'normal',
        alwaysActive: lorebook.alwaysActive,
        selective: lorebook.useMultipleKeys,
        useRegex: lorebook.useRegex
    };
}

function risuScriptToKei(script: RisuRegexScript, index: number): KeiScriptPayload {
    return {
        id: `script_${index}`,
        type: 'regex',
        name: script.comment ?? `Script ${index + 1}`,
        regex: script.in ?? '',
        replacement: script.out ?? '',
        phase: risuScriptPhase(script.type),
        flag: script.flag ?? 'g',
        advanced: script.ableFlag ?? false,
        order: index,
        repeat: 1,
        enabled: script.type !== 'disabled'
    };
}

function keiScriptToRisu(script: ScriptFields): RisuRegexScript {
    return {
        comment: script.name,
        in: script.regex,
        out: script.replacement,
        type: script.enabled ? keiScriptPhase(script.phase) : 'disabled',
        flag: script.flag,
        ableFlag: script.advanced
    };
}

function risuScriptPhase(type: string | undefined): ScriptFields['phase'] {
    if (type === 'editinput') return 'input';
    if (type === 'editprocess') return 'request';
    if (type === 'editoutput') return 'output';
    return 'display';
}

function keiScriptPhase(phase: ScriptFields['phase']): string {
    if (phase === 'input') return 'editinput';
    if (phase === 'request') return 'editprocess';
    if (phase === 'output') return 'editoutput';
    return 'editdisplay';
}

function refs<T extends { id: string }>(items: T[]): EntityListConfig {
    return {
        refs: Object.fromEntries(
            items.map((item, index) => [item.id, { id: item.id, sortOrder: sortOrder(index) }])
        ),
        folders: {}
    };
}

function sortOrder(index: number): string {
    return index.toString().padStart(6, '0');
}

function extensionFromName(value: string): string {
    const match = /\.([a-z0-9]+)$/i.exec(value);
    return match?.[1] ?? 'webp';
}

function extensionFromPath(value: string): string {
    return extensionFromName(value);
}
