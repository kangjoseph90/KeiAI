export interface KeiAssetPayload {
    id: string;
    data?: Uint8Array;
    hash?: string;
    encKey?: string;
}

export interface SerializedKeiAssetPayload {
    id: string;
    path?: string;
    hash?: string;
    encKey?: string;
}

export type KeiAssetPayloadKind = 'baked' | 'light' | 'broken';

export function classifyAsset(asset: KeiAssetPayload): KeiAssetPayloadKind {
    const hasData = asset.data != null;
    const hasHash = !!asset.hash;
    const hasEncKey = !!asset.encKey;

    if (hasData) return 'baked';
    if (!hasData && hasHash && hasEncKey) return 'light';
    return 'broken';
}
