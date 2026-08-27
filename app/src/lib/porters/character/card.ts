import type { KeiCharacterPackageV1 } from './types';
import type { CardAsset, CharacterCardV3 } from './ccv3';
import { sanitizeFileName } from '$lib/utils/file';
import { toBase64, toDataUrl } from '$lib/crypto';
import { keiLorebookToRisuCardEntry, keiLorebookToRisuInternal } from '../risu/lorebook';
import { keiScriptToRisu } from '../risu/script';
import { toKeiPackageJson } from './package';
import { writeDefaultVariables } from '../utils';
import { denormalizeRisuTemplate } from '../risu/template';
import { backgroundWithMessageCSS } from '../risu/background';
import { compareSortOrder, listItems } from '$lib/utils/ordering';

export type CardAssetUriMode = 'data' | 'png' | 'charx';

export function keiPackageToCard(
    pkg: KeiCharacterPackageV1,
    assetUriMode: CardAssetUriMode
): CharacterCardV3 {
    const greetings = Object.values(pkg.character.greetings).sort((a, b) =>
        compareSortOrder(a.sortOrder, b.sortOrder)
    );

    const cardAssets: CardAsset[] = [];

    // List assets from pkg.assets Record
    for (const [layoutId, asset] of Object.entries(pkg.assets)) {
        if (!asset.data) continue;
        cardAssets.push(cardAssetFromEntry(pkg, layoutId, asset, false, assetUriMode));
    }

    // Avatar as 'icon' asset
    if (pkg.avatar?.data) {
        cardAssets.push(cardAssetFromEntry(pkg, '__avatar__', pkg.avatar, true, assetUriMode));
    }

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
                entries: listItems(pkg.character.lorebooks).map(keiLorebookToRisuCardEntry)
            },
            assets: cardAssets,
            tags: [],
            creator: '',
            character_version: '',
            extensions: {
                risuai: {
                    customScripts: listItems(pkg.character.scripts).map(keiScriptToRisu),
                    triggerscript: [],
                    defaultVariables: writeDefaultVariables(pkg.character.defaultVariables),
                    backgroundHTML: denormalizeRisuTemplate(
                        backgroundWithMessageCSS(
                            pkg.character.backgroundHTML,
                            pkg.character.messageCSS
                        )
                    ),
                    lowLevelAccess: pkg.character.allowLowLevel
                },
                keiai: toKeiPackageJson(pkg, {
                    assetPath: (key) => assetPath(pkg, key)
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
        regex: listItems(pkg.character.scripts).map(keiScriptToRisu),
        lorebook: listItems(pkg.character.lorebooks).map(keiLorebookToRisuInternal)
    };
}

export function assetPath(pkg: KeiCharacterPackageV1, assetKey: string): string {
    const isAvatar = assetKey === '__avatar__';
    const asset = pkg.assets[assetKey] ?? pkg.avatar;
    const ext = assetExt(asset?.data);
    const type = isAvatar ? 'icon' : 'x-risu-asset';
    const media = ext === 'mp3' || ext === 'wav' || ext === 'ogg' ? 'audio' : 'images';
    const name = isAvatar
        ? 'main'
        : sanitizeFileName(pkg.character.assets.refs[assetKey]?.name || assetKey);
    return `assets/${type}/${media}/${name}.${ext}`;
}

function cardAssetFromEntry(
    pkg: KeiCharacterPackageV1,
    assetKey: string,
    asset: { data?: Uint8Array; hash?: string; encKey?: string },
    isAvatar: boolean,
    uriMode: CardAssetUriMode
): CardAsset {
    return {
        type: isAvatar ? 'icon' : 'x-risu-asset',
        uri: assetUri(pkg, assetKey, asset, isAvatar, uriMode),
        name: isAvatar ? 'main' : pkg.character.assets.refs[assetKey]?.name || assetKey,
        ext: assetExt(asset?.data)
    };
}

function assetUri(
    pkg: KeiCharacterPackageV1,
    assetKey: string,
    asset: { data?: Uint8Array },
    isAvatar: boolean,
    uriMode: CardAssetUriMode
): string {
    if (uriMode === 'charx') return `embeded://${assetPath(pkg, assetKey)}`;
    if (uriMode === 'png') {
        return isAvatar ? 'ccdefault:' : `__asset:${assetPath(pkg, assetKey)}`;
    }

    const ext = assetExt(asset?.data);
    return asset?.data ? toDataUrl(mimeType(ext), toBase64(asset.data)) : '';
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
