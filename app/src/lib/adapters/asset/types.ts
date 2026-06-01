/**
 * Local Asset Store Interface - KeiAI
 *
 * Asset registry rows and local /assets blobs are one local storage unit.
 * The adapter owns registry IDs and storage paths; callers work with owner/hash
 * locators instead of constructing IDs or paths directly.
 */

import type { DataScope, DataScopeType, TableName } from '$lib/adapters/db';
import type { AssetStatus } from '$lib/types/asset';

export interface AssetOwner {
    scopeType: DataScopeType;
    scopeId: string;
    ownerTable: TableName;
    ownerId: string;
}

export interface AssetLocator extends AssetOwner {
    hash: string;
}

export interface AssetRegistryRecord extends AssetLocator {
    id: string; // `${scopeType}:${scopeId}:${ownerTable}:${ownerId}:${hash}`
    encKey: string;
    status: AssetStatus;
    size: number; // cached blob size in bytes
    accessedAt: number; // LRU eviction timestamp
}

export interface PutAssetInput extends AssetLocator {
    encKey: string;
    bytes: Uint8Array;
}

export function assetRegistryId(locator: AssetLocator): string {
    return `${locator.scopeType}:${locator.scopeId}:${locator.ownerTable}:${locator.ownerId}:${locator.hash}`;
}

export interface IAssetAdapter {
    flush(): Promise<void>;

    putLocalAsset(input: PutAssetInput): Promise<AssetRegistryRecord>;
    putRemoteAsset(input: PutAssetInput): Promise<AssetRegistryRecord>;

    getAsset(locator: AssetLocator): Promise<AssetRegistryRecord | undefined>;
    deleteAsset(locator: AssetLocator): Promise<void>;
    deleteOwnerAssets(owner: AssetOwner): Promise<void>;
    deleteScopeAssets(scope: DataScope): Promise<void>;

    getAllLocalAssets(scope: DataScope): Promise<AssetRegistryRecord[]>;
    getAllRemoteAssets(scope?: DataScope): Promise<AssetRegistryRecord[]>;

    readAssetBytes(locator: AssetLocator): Promise<Uint8Array | null>;
    getRenderUrl(locator: AssetLocator): Promise<string | null>;
    revokeRenderUrl(url: string): Promise<void>;
    touchAsset(locator: AssetLocator): Promise<void>;

    markAssetRemote(locator: AssetLocator): Promise<void>;
    markAssetLocal(locator: AssetLocator): Promise<void>;
    markAssetsRemote(locators: AssetLocator[]): Promise<void>;
    markAssetsLocal(locators: AssetLocator[]): Promise<void>;

    transaction<R>(callback: () => Promise<R>): Promise<R>;
}
