/**
 * Web Local Asset Store - KeiAI
 *
 * Dexie stores local asset registry metadata. appStorage owns local blobs, but
 * this adapter hides /assets paths so callers cannot update metadata and blobs
 * independently.
 */

import Dexie, { type Table } from 'dexie';
import { appStorage } from '$lib/adapters/storage';
import { clock } from '$lib/utils/clock';
import {
    assetRegistryId,
    type AssetLocator,
    type AssetOwner,
    type AssetRegistryRecord,
    type IAssetAdapter,
    type PutAssetInput
} from './types';
import type { DataScope } from '$lib/adapters/db';
import type { AssetStatus } from '$lib/types/asset';

class AssetDexie extends Dexie {
    assetRegistry!: Table<AssetRegistryRecord, string>;

    constructor() {
        super('KeiAssets');
        this.version(1).stores({
            assetRegistry:
                'id, [scopeType+scopeId], [scopeType+scopeId+ownerTable+ownerId], [scopeType+scopeId+ownerTable+ownerId+hash], [scopeType+scopeId+status], [scopeType+scopeId+status+accessedAt]'
        });
    }
}

const assetDB = new AssetDexie();

function storagePath(id: string): string {
    return `assets/${encodeURIComponent(id)}`;
}

function toRecord(input: PutAssetInput, status: AssetStatus): AssetRegistryRecord {
    return {
        id: assetRegistryId(input),
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        ownerTable: input.ownerTable,
        ownerId: input.ownerId,
        hash: input.hash,
        encKey: input.encKey,
        status,
        size: input.bytes.byteLength,
        accessedAt: clock.now()
    };
}

export class WebAssetAdapter implements IAssetAdapter {
    async flush(): Promise<void> {
        return Promise.resolve();
    }

    async putLocalAsset(input: PutAssetInput): Promise<AssetRegistryRecord> {
        return this.putAsset(input, 'local');
    }

    async putRemoteAsset(input: PutAssetInput): Promise<AssetRegistryRecord> {
        return this.putAsset(input, 'remote');
    }

    private async putAsset(
        input: PutAssetInput,
        status: AssetStatus
    ): Promise<AssetRegistryRecord> {
        const record = toRecord(input, status);
        await appStorage.write(storagePath(record.id), input.bytes);
        try {
            await assetDB.assetRegistry.put(record);
        } catch (error) {
            await appStorage.delete(storagePath(record.id)).catch(() => undefined);
            throw error;
        }
        return record;
    }

    async getAsset(locator: AssetLocator): Promise<AssetRegistryRecord | undefined> {
        return assetDB.assetRegistry.get(assetRegistryId(locator));
    }

    async deleteAsset(locator: AssetLocator): Promise<void> {
        await this.deleteByIds([assetRegistryId(locator)]);
    }

    async deleteOwnerAssets(owner: AssetOwner): Promise<void> {
        const records = await assetDB.assetRegistry
            .where('[scopeType+scopeId+ownerTable+ownerId]')
            .equals([owner.scopeType, owner.scopeId, owner.ownerTable, owner.ownerId])
            .toArray();
        await this.deleteByIds(records.map((record) => record.id));
    }

    async deleteScopeAssets(scope: DataScope): Promise<void> {
        const records = await assetDB.assetRegistry
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .toArray();
        await this.deleteByIds(records.map((record) => record.id));
    }

    private async deleteByIds(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        await assetDB.transaction('rw', assetDB.assetRegistry, async () => {
            await assetDB.assetRegistry.bulkDelete(ids);
        });
        await Promise.all(
            ids.map((id) => appStorage.delete(storagePath(id)).catch(() => undefined))
        );
    }

    async getAllLocalAssets(scope: DataScope): Promise<AssetRegistryRecord[]> {
        return this.getAllByStatus(scope, 'local');
    }

    async getAllRemoteAssets(scope?: DataScope): Promise<AssetRegistryRecord[]> {
        if (scope) return this.getAllByStatus(scope, 'remote');
        return assetDB.assetRegistry
            .where('status')
            .equals('remote')
            .toArray()
            .then((records) => records.sort((a, b) => a.accessedAt - b.accessedAt));
    }

    private async getAllByStatus(
        scope: DataScope,
        status: AssetStatus
    ): Promise<AssetRegistryRecord[]> {
        return assetDB.assetRegistry
            .where('[scopeType+scopeId+status]')
            .equals([scope.scopeType, scope.scopeId, status])
            .toArray()
            .then((records) => records.sort((a, b) => a.accessedAt - b.accessedAt));
    }

    async readAssetBytes(locator: AssetLocator): Promise<Uint8Array | null> {
        return appStorage.read(storagePath(assetRegistryId(locator)));
    }

    async getRenderUrl(locator: AssetLocator): Promise<string | null> {
        const id = assetRegistryId(locator);
        const url = await appStorage.getRenderUrl(storagePath(id));
        if (url) {
            await this.touchAsset(locator);
        }
        return url;
    }

    async revokeRenderUrl(url: string): Promise<void> {
        await appStorage.revokeRenderUrl(url);
    }

    async touchAsset(locator: AssetLocator): Promise<void> {
        await this.markAsset(locator, undefined);
    }

    async markAssetRemote(locator: AssetLocator): Promise<void> {
        await this.markAsset(locator, 'remote');
    }

    async markAssetLocal(locator: AssetLocator): Promise<void> {
        await this.markAsset(locator, 'local');
    }

    async markAssetsRemote(locators: AssetLocator[]): Promise<void> {
        await this.markAssets(locators, 'remote');
    }

    async markAssetsLocal(locators: AssetLocator[]): Promise<void> {
        await this.markAssets(locators, 'local');
    }

    private async markAssets(locators: AssetLocator[], status: AssetStatus): Promise<void> {
        await assetDB.transaction('rw', assetDB.assetRegistry, async () => {
            for (const locator of locators) {
                await this.markAsset(locator, status);
            }
        });
    }

    private async markAsset(
        locator: AssetLocator,
        status: AssetStatus | undefined
    ): Promise<boolean> {
        const id = assetRegistryId(locator);
        const existing = await assetDB.assetRegistry.get(id);
        if (!existing) return false;

        const next: AssetRegistryRecord = {
            ...existing,
            status: status ?? existing.status,
            accessedAt: clock.now()
        };
        if (next.status === existing.status && next.accessedAt === existing.accessedAt) {
            return false;
        }

        await assetDB.assetRegistry.put(next);
        return true;
    }

    async transaction<R>(callback: () => Promise<R>): Promise<R> {
        await this.flush();
        return assetDB.transaction('rw', assetDB.assetRegistry, callback);
    }
}

export const webAsset = new WebAssetAdapter();
