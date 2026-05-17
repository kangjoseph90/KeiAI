import type { LLMRole } from '$lib/types/models/llm';
import type { KeiCharacterPackageV1, KeiLorebookPayload, KeiScriptPayload } from './types';
import type { CardAsset, CharacterBookEntry, CharacterCardV3, RisuRegexScript } from './ccv3';
import { addRisuLorebookDecorators } from './lorebook';
import { bytesToBase64, toKeiPackageJson } from './package';

export type CardAssetUriMode = 'data' | 'png' | 'charx';

export function keiPackageToCard(
    pkg: KeiCharacterPackageV1,
    assetUriMode: CardAssetUriMode
): CharacterCardV3 {
    const greetings = Object.values(pkg.character.greetings).sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    );

    return {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
            name: pkg.character.name,
            description: pkg.character.description,
            personality: '',
            scenario: '',
            first_mes: greetings[0]?.content ?? '',
            alternate_greetings: greetings.slice(1).map((greeting) => greeting.content),
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: pkg.character.characterNote,
            character_book: {
                extensions: {},
                recursive_scanning: false,
                entries: pkg.lorebooks.map(lorebookToCardEntry)
            },
            assets: pkg.assets
                .filter((asset) => asset.data)
                .map((asset) => cardAsset(pkg, asset.id, assetUriMode)),
            tags: [],
            creator: '',
            character_version: '',
            extensions: {
                risuai: {
                    customScripts: pkg.scripts.map(scriptToRisuRegex),
                    triggerscript: [],
                    defaultVariables: defaultVariablesString(pkg.character.defaultVariables),
                    lowLevelAccess: pkg.character.allowLowLevel
                },
                keiai: toKeiPackageJson(pkg, {
                    assetPath: (id) => assetPath(pkg, id)
                })
            },
            group_only_greetings: []
        }
    };
}

export function keiPackageToRisuModule(pkg: KeiCharacterPackageV1) {
    return {
        name: `${pkg.character.name || 'Imported Character'} Module`,
        description: `Module for ${pkg.character.name || 'Imported Character'}`,
        id: 'keiai_export_module',
        trigger: [],
        regex: pkg.scripts.map(scriptToRisuRegex),
        lorebook: pkg.lorebooks.map((lorebook) => ({
            key: lorebook.key,
            secondkey: lorebook.secondKey,
            insertorder: lorebook.order,
            comment: lorebook.name,
            content: addRisuLorebookDecorators(lorebook),
            mode: lorebook.useMultipleKeys
                ? 'multiple'
                : lorebook.alwaysActive
                  ? 'constant'
                  : 'normal',
            alwaysActive: lorebook.alwaysActive,
            selective: lorebook.useMultipleKeys,
            useRegex: lorebook.useRegex
        }))
    };
}

export function assetPath(pkg: KeiCharacterPackageV1, assetId: string): string {
    const isAvatar = assetId === pkg.character.avatarAssetId;
    const asset = pkg.assets.find((item) => item.id === assetId);
    const ext = assetExt(asset?.data);
    const type = isAvatar ? 'icon' : 'x-risu-asset';
    const media = ext === 'mp3' || ext === 'wav' || ext === 'ogg' ? 'audio' : 'images';
    const name = isAvatar ? 'main' : safeName(pkg.character.assets.refs[assetId]?.name || assetId);
    return `assets/${type}/${media}/${name}.${ext}`;
}

function cardAsset(
    pkg: KeiCharacterPackageV1,
    assetId: string,
    uriMode: CardAssetUriMode
): CardAsset {
    const asset = pkg.assets.find((item) => item.id === assetId);
    const isAvatar = assetId === pkg.character.avatarAssetId;
    return {
        type: isAvatar ? 'icon' : 'x-risu-asset',
        uri: assetUri(pkg, assetId, uriMode),
        name: isAvatar ? 'main' : pkg.character.assets.refs[assetId]?.name || assetId,
        ext: assetExt(asset?.data)
    };
}

function assetUri(pkg: KeiCharacterPackageV1, assetId: string, uriMode: CardAssetUriMode): string {
    if (uriMode === 'charx') return `embeded://${assetPath(pkg, assetId)}`;
    if (uriMode === 'png')
        return assetId === pkg.character.avatarAssetId
            ? 'ccdefault:'
            : `__asset:${assetPath(pkg, assetId)}`;

    const asset = pkg.assets.find((item) => item.id === assetId);
    const ext = assetExt(asset?.data);
    return asset?.data ? `data:${mimeType(ext)};base64,${bytesToBase64(asset.data)}` : '';
}

function lorebookToCardEntry(lorebook: KeiLorebookPayload): CharacterBookEntry {
    return {
        keys: splitKeys(lorebook.key),
        secondary_keys: lorebook.useMultipleKeys ? splitKeys(lorebook.secondKey) : undefined,
        content: addRisuLorebookDecorators(lorebook),
        extensions: {},
        enabled: !lorebook.disabled,
        insertion_order: lorebook.order,
        use_regex: lorebook.useRegex,
        constant: lorebook.alwaysActive,
        selective: lorebook.useMultipleKeys,
        name: lorebook.name,
        comment: lorebook.name,
        mode: lorebook.useMultipleKeys ? 'multiple' : lorebook.alwaysActive ? 'constant' : 'normal'
    };
}

function scriptToRisuRegex(script: KeiScriptPayload): RisuRegexScript {
    return {
        comment: script.name,
        in: script.regex,
        out: script.replacement,
        type: script.enabled ? scriptPhase(script.phase) : 'disabled',
        flag: script.advanced ? script.flag : 'g',
        ableFlag: script.advanced
    };
}

function scriptPhase(phase: KeiScriptPayload['phase']): string {
    if (phase === 'input') return 'editinput';
    if (phase === 'request') return 'editprocess';
    if (phase === 'output') return 'editoutput';
    return 'editdisplay';
}

function defaultVariablesString(vars: Record<string, string>): string {
    return Object.entries(vars)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
}

function splitKeys(value: string): string[] {
    return value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
}

function safeName(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'asset';
}

function assetExt(bytes: Uint8Array | undefined): string {
    if (!bytes) return 'bin';
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        return 'webp';
    }
    return 'bin';
}

function mimeType(ext: string): string {
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'application/octet-stream';
}
