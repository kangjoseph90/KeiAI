import type { CharacterFields, CharJSFields, LorebookFields, ScriptFields } from '$lib/services';

export interface KeiCharacterPackageV1 {
    version: 1;
    kind: 'keiai.character';
    character: KeiCharacterPayload;
    lorebooks: KeiLorebookPayload[];
    scripts: KeiScriptPayload[];
    charjs: KeiCharJSPayload[];
    assets: KeiAssetPayload[];
}

export type KeiCharacterPayload = Omit<CharacterFields, 'modules'>;
export type KeiLorebookPayload = LorebookFields & { id: string };
export type KeiScriptPayload = ScriptFields & { id: string };
export type KeiCharJSPayload = CharJSFields & { id: string };

export interface KeiAssetPayload {
    id: string;
    data?: Uint8Array;
    hash?: string;
    encKey?: string;
}

export type KeiAssetPayloadKind = 'baked' | 'light' | 'broken';

export function classifyAsset(asset: KeiAssetPayload): KeiAssetPayloadKind {
    const hasData = asset.data != null;
    const hasHash = !!asset.hash;
    const hasEncKey = !!asset.encKey;

    if (hasData && hasHash && hasEncKey) return 'baked';
    if (!hasData && hasHash && hasEncKey) return 'light';
    return 'broken';
}
