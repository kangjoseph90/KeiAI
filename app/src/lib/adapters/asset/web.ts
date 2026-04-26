/**
 * Web Asset Adapter — KeiAI
 *
 * Implements IAssetAdapter using a dedicated Dexie database for asset metadata.
 * Binary blobs are stored via appStorage (OPFS) directly by the service layer.
 */

import Dexie, { type Table } from 'dexie';
import { AssetWriteEventEmitter } from './events';
import type {
    IAssetAdapter,
    AssetRecord,
    AssetRegistryRecord,
    AssetWriteEventListener,
    AssetWriteOptions,
    AssetTableName,
    AssetWriteOperation,
    AssetStatus,
    AssetKindPlain
} from './types';
import { clock } from '$lib/utils/clock';

class AssetDexie extends Dexie {
    assets!: Table<AssetRecord, string>;
    assetRegistry!: Table<AssetRegistryRecord, string>;

    constructor() {
        super('KeiAssets');
        this.version(1).stores({
            assets: 'id, userId, updatedAt, isDeleted',
            assetRegistry:
                'id, userId, [userId+status], [userId+status+kind], [userId+isDeleted], accessedAt'
        });
    }
}

const assetDB = new AssetDexie();

export class WebAssetAdapter implements IAssetAdapter {
    private readonly writeEvents = new AssetWriteEventEmitter();

    subscribeWriteEvents(listener: AssetWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    private emitWriteEvent(
        tableName: AssetTableName,
        operation: AssetWriteOperation,
        ids: string[],
        options?: AssetWriteOptions
    ): void {
        this.writeEvents.emit({
            tableName,
            operation,
            ids,
            origin: options?.origin ?? 'local'
        });
    }

    // ── Metadata (assets table) ──────────────────────────────────────

    async getAsset(id: string): Promise<AssetRecord | undefined> {
        return assetDB.assets.get(id);
    }

    async getAllAssets(userId: string): Promise<AssetRecord[]> {
        return assetDB.assets
            .where('userId')
            .equals(userId)
            .filter((record) => !record.isDeleted)
            .sortBy('updatedAt');
    }

    async putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assets.put(record);
        this.emitWriteEvent('assets', 'put', [record.id], options);
    }

    async softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
        const existing = await assetDB.assets.get(id);
        if (!existing) return;

        await assetDB.assets.put({
            ...existing,
            isDeleted: true,
            updatedAt: clock.now()
        });
        this.emitWriteEvent('assets', 'softDelete', [id], options);
    }

    async getAssetsSince(userId: string, sinceUpdatedAt: number): Promise<AssetRecord[]> {
        return assetDB.assets
            .where('userId')
            .equals(userId)
            .filter((record) => record.updatedAt > sinceUpdatedAt)
            .sortBy('updatedAt');
    }

    // ── Registry (assetRegistry table) ───────────────────────────────

    async getRegistry(id: string): Promise<AssetRegistryRecord | undefined> {
        return assetDB.assetRegistry.get(id);
    }

    async getAllRegistry(userId: string): Promise<AssetRegistryRecord[]> {
        return assetDB.assetRegistry.where('[userId+isDeleted]').equals([userId, 0]).toArray();
    }

    async getDeletedRegistry(userId: string): Promise<AssetRegistryRecord[]> {
        return assetDB.assetRegistry.where('[userId+isDeleted]').equals([userId, 1]).toArray();
    }

    async getRegistryByStatus(
        userId: string,
        status: AssetStatus,
        kinds?: AssetKindPlain[]
    ): Promise<AssetRegistryRecord[]> {
        if (!kinds || kinds.length === 0) {
            return assetDB.assetRegistry
                .where('[userId+status]')
                .equals([userId, status])
                .filter((r) => !r.isDeleted)
                .toArray();
        }

        const keys = kinds.map((k) => [userId, status, k]);
        return assetDB.assetRegistry
            .where('[userId+status+kind]')
            .anyOf(keys)
            .filter((r) => !r.isDeleted)
            .toArray();
    }

    async putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assetRegistry.put(record);
        this.emitWriteEvent('assetRegistry', 'put', [record.id], options);
    }

    async softDeleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
        const existing = await assetDB.assetRegistry.get(id);
        if (!existing) return;

        await assetDB.assetRegistry.put({
            ...existing,
            isDeleted: true,
            updatedAt: clock.now()
        });
        this.emitWriteEvent('assetRegistry', 'softDelete', [id], options);
    }

    async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assetRegistry.delete(id);
        this.emitWriteEvent('assetRegistry', 'delete', [id], options);
    }
}

export const webAsset = new WebAssetAdapter();
