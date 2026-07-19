import type { Lorebook, LorebookFields, Script } from '$lib/services';
import { generateId } from '$lib/utils/id';
import { generateKeyBetween } from 'fractional-indexing';
import type { CharacterBookEntry, CharacterCardV3 } from './ccv3';
import { fromKeiPackageJson, base64ToBytes } from './package';
import { readRisuLorebookDecorators } from '../risu/lorebook';
import { risuScriptToKei } from '../risu/script';
import { normalizeRisuTemplate } from '../risu/template';
import { extractStyleCSS } from '../risu/background';
import { readDefaultVariables, sortOrder } from '../utils';
import type { KeiCharacterPackageV1, KeiCharacterPayload } from './types';

interface ImportedRisuCharacter {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    firstMessage: string;
    alternateGreetings: string[];
    systemPrompt: string;
    postHistoryInstructions: string;
    backgroundHTML: string;
    messageCSS: string;
    defaultVariables: Record<string, string>;
    allowLowLevel: boolean;
    lorebooks: LorebookFields[];
    scripts: Script[];
    assets: ImportedRisuAsset[];
}

interface ImportedRisuAsset {
    name: string;
    data: Uint8Array;
    role: 'avatar' | 'resource';
}

export function keiPackageFromCard(
    card: CharacterCardV3,
    files: Record<string, Uint8Array>
): KeiCharacterPackageV1 | null {
    const keiai = card.data.extensions.keiai;
    if (!keiai) return null;
    return fromKeiPackageJson(keiai, files);
}

export function cardToKeiPackage(
    card: CharacterCardV3,
    files: Record<string, Uint8Array> = {},
    defaultImage?: Uint8Array
): KeiCharacterPackageV1 {
    const keiai = keiPackageFromCard(card, files);
    if (keiai) return keiai;

    const character = readRisuCharacter(card, files, defaultImage);
    return risuCharacterToKeiPackage(character);
}

function readRisuCharacter(
    card: CharacterCardV3,
    files: Record<string, Uint8Array>,
    defaultImage?: Uint8Array
): ImportedRisuCharacter {
    const data = card.data;
    const risuai = data.extensions.risuai ?? {};
    const assets = resolveAssets(card, files, defaultImage);
    const backgroundHTML =
        typeof risuai.backgroundHTML === 'string'
            ? normalizeRisuTemplate(risuai.backgroundHTML)
            : '';

    return {
        name: data.name,
        description: normalizeRisuTemplate(data.description),
        personality: normalizeRisuTemplate(data.personality),
        scenario: normalizeRisuTemplate(data.scenario),
        firstMessage: normalizeRisuTemplate(data.first_mes),
        alternateGreetings: data.alternate_greetings.map(normalizeRisuTemplate),
        systemPrompt: normalizeRisuTemplate(data.system_prompt),
        postHistoryInstructions: normalizeRisuTemplate(data.post_history_instructions),
        backgroundHTML,
        messageCSS: extractStyleCSS(backgroundHTML),
        defaultVariables: readDefaultVariables(risuai.defaultVariables),
        allowLowLevel: risuai.lowLevelAccess ?? false,
        lorebooks: (data.character_book?.entries ?? []).map((entry, index) =>
            cardLorebookToFields(entry, index)
        ),
        scripts: (risuai.customScripts ?? []).map((script, index) => ({
            ...risuScriptToKei(script, index),
            sortOrder: sortOrder(index)
        })),
        assets
    };
}

function risuCharacterToKeiPackage(risu: ImportedRisuCharacter): KeiCharacterPackageV1 {
    const avatarAsset =
        risu.assets.find((asset) => asset.role === 'avatar' && asset.name === 'main') ??
        risu.assets.find((asset) => asset.role === 'avatar');
    const resources = risu.assets.filter((asset) => asset !== avatarAsset);
    const lorebooks = risu.lorebooks.map(
        (lorebook, index): Lorebook => ({
            id: portableId('lorebook', index),
            sortOrder: sortOrder(index),
            ...lorebook
        })
    );
    const scripts = risu.scripts;

    // Build list assets as Record<layoutId, { data }>
    const assetEntries: [string, { data: Uint8Array }][] = resources.map((item, index) => [
        portableId('asset', index),
        { data: item.data }
    ]);

    const character: KeiCharacterPayload = {
        name: risu.name || 'Imported Character',
        description: risu.description,
        characterNote: [
            risu.personality,
            risu.scenario,
            risu.systemPrompt,
            risu.postHistoryInstructions
        ]
            .map((value) => value.trim())
            .filter(Boolean)
            .join('\n'),
        backgroundHTML: risu.backgroundHTML,
        messageCSS: risu.messageCSS,
        greetings: createGreetings([risu.firstMessage, ...risu.alternateGreetings]),
        defaultVariables: { ...risu.defaultVariables },
        allowLowLevel: risu.allowLowLevel,
        lorebooks: {
            refs: Object.fromEntries(
                lorebooks.map((item, index) => [
                    item.id,
                    { ...item, id: item.id, sortOrder: sortOrder(index) }
                ])
            ),
            folders: {}
        },
        scripts: {
            refs: Object.fromEntries(
                scripts.map((item, index) => [
                    item.id,
                    { ...item, id: item.id, sortOrder: sortOrder(index) }
                ])
            ),
            folders: {}
        },
        charjs: { refs: {}, folders: {} },
        assets: {
            refs: Object.fromEntries(
                resources.map((item, index) => {
                    const layoutId = portableId('asset', index);
                    return [
                        layoutId,
                        {
                            id: layoutId,
                            name: item.name,
                            sortOrder: sortOrder(index),
                            hash: '',
                            encKey: '',
                            mimeType: ''
                        }
                    ];
                })
            ),
            folders: {}
        }
    };

    return {
        version: 1,
        kind: 'keiai.character',
        character,
        assets: Object.fromEntries(assetEntries),
        ...(avatarAsset ? { avatar: { data: avatarAsset.data } } : {})
    };
}

function createGreetings(contents: string[]): KeiCharacterPayload['greetings'] {
    const greetings: KeiCharacterPayload['greetings'] = {};
    let prev: string | null = null;
    for (const content of contents.filter(Boolean)) {
        const id = generateId();
        const sort = generateKeyBetween(prev, null);
        greetings[id] = { id, content, sortOrder: sort };
        prev = sort;
    }
    return greetings;
}

function resolveAssets(
    card: CharacterCardV3,
    files: Record<string, Uint8Array>,
    defaultImage?: Uint8Array
): ImportedRisuAsset[] {
    const assets: ImportedRisuAsset[] = [];
    for (const [, asset] of (card.data.assets ?? []).entries()) {
        const data = resolveAssetData(asset.uri, files, defaultImage);
        if (!data) continue;
        assets.push({
            name: asset.name || asset.type,
            data,
            role: asset.type === 'icon' ? 'avatar' : 'resource'
        });
    }

    if (!assets.some((asset) => asset.role === 'avatar') && defaultImage) {
        assets.push({
            name: 'avatar',
            data: defaultImage,
            role: 'avatar'
        });
    }

    return assets;
}

function resolveAssetData(
    uri: string,
    files: Record<string, Uint8Array>,
    defaultImage?: Uint8Array
): Uint8Array | null {
    if (uri === 'ccdefault:') return defaultImage ?? null;
    if (uri.startsWith('embeded://')) return files[uri.slice('embeded://'.length)] ?? null;
    if (uri.startsWith('__asset:')) return files[uri.slice('__asset:'.length)] ?? null;
    if (!uri.startsWith('data:')) return null;

    const comma = uri.indexOf(',');
    if (comma === -1) return null;
    return base64ToBytes(uri.slice(comma + 1));
}

function cardLorebookToFields(entry: CharacterBookEntry, index: number): LorebookFields {
    return readRisuLorebookDecorators({
        name: entry.name ?? entry.comment ?? `Lorebook ${index + 1}`,
        key: entry.keys.join(', '),
        secondKey: entry.secondary_keys?.join(', ') ?? '',
        content: normalizeRisuTemplate(entry.content),
        depth: 1,
        order: entry.insertion_order,
        alwaysActive: entry.constant ?? false,
        disabled: !entry.enabled,
        role: 'system',
        useRegex: entry.use_regex,
        useMultipleKeys: entry.selective ?? false,
        probability: 100,
        recursive: false,
        noRecursiveSearch: false
    });
}

function portableId(prefix: string, index: number): string {
    return `${prefix}_${index}`;
}
