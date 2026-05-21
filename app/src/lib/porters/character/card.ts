import type { LLMRole } from '$lib/types/models/llm';
import type { KeiCharacterPackageV1 } from './types';
import type { CardAsset, CharacterCardV3 } from './ccv3';
import { bytesToBase64, toKeiPackageJson } from './package';
import { keiLorebookToRisuCardEntry, keiLorebookToRisuInternal } from '../risu/lorebook';
import { keiScriptToRisu } from '../risu/script';
import { sanitizeFileName } from '$lib/utils/file';
import { writeDefaultVariables } from '../utils';
import { denormalizeRisuTemplate } from '../risu/template';

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
            description: denormalizeRisuTemplate(pkg.character.description),
            personality: '',
            scenario: '',
            first_mes: denormalizeRisuTemplate(greetings[0]?.content ?? ''),
            alternate_greetings: greetings
                .slice(1)
                .map((greeting) => denormalizeRisuTemplate(greeting.content)),
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: denormalizeRisuTemplate(pkg.character.characterNote),
            character_book: {
                extensions: {},
                recursive_scanning: false,
                entries: pkg.lorebooks.map(keiLorebookToRisuCardEntry)
            },
            assets: pkg.assets
                .filter((asset) => asset.data)
                .map((asset) => cardAsset(pkg, asset.id, assetUriMode)),
            tags: [],
            creator: '',
            character_version: '',
            extensions: {
                risuai: {
                    customScripts: pkg.scripts.map(keiScriptToRisu),
                    triggerscript: [],
                    defaultVariables: writeDefaultVariables(pkg.character.defaultVariables),
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
        regex: pkg.scripts.map(keiScriptToRisu),
        lorebook: pkg.lorebooks.map(keiLorebookToRisuInternal)
    };
}

export function assetPath(pkg: KeiCharacterPackageV1, assetId: string): string {
    const isAvatar = assetId === pkg.character.avatarAssetId;
    const asset = pkg.assets.find((item) => item.id === assetId);
    const ext = assetExt(asset?.data);
    const type = isAvatar ? 'icon' : 'x-risu-asset';
    const media = ext === 'mp3' || ext === 'wav' || ext === 'ogg' ? 'audio' : 'images';
    const name = isAvatar
        ? 'main'
        : sanitizeFileName(pkg.character.assets.refs[assetId]?.name || assetId);
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
