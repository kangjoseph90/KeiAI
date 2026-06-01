export interface AssetFields {
    name: string;
    hash: string;
    encKey: string;
    mimeType: string;
}

export type AssetStatus = 'local' | 'remote';
export type AssetEntries = Record<string, AssetStatus>;
