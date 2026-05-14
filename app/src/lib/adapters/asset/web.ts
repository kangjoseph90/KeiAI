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
    AssetKind
} from './types';
import type { DataScope } from '$lib/adapters/db';
import { clock } from '$lib/utils/clock';

class AssetDexie extends Dexie {
    assets!: Table<AssetRecord, string>;
    assetRegistry!: Table<AssetRegistryRecord, string>;

    constructor() {
        super('KeiAssets');
        this.version(1).stores({
            assets: 'id, [scopeType+scopeId], [scopeType+scopeId+updatedAt], updatedAt, isDeleted',
            assetRegistry:
                'id, [scopeType+scopeId], [scopeType+scopeId+status], [scopeType+scopeId+status+kind], [scopeType+scopeId+isDeleted], status, [status+kind], accessedAt'
        });
    }
}

const assetDB = new AssetDexie();

export class WebAssetAdapter implements IAssetAdapter {
    private readonly writeEvents = new AssetWriteEventEmitter();

    subscribeWriteEvents(listener: AssetWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    async flush(): Promise<void> {
        return Promise.resolve();
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

    async getAllAssets(scope: DataScope): Promise<AssetRecord[]> {
        return assetDB.assets
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
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

    async deleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assets.delete(id);
        this.emitWriteEvent('assets', 'delete', [id], options);
    }

    async getAssetsSince(scope: DataScope, sinceUpdatedAt: number): Promise<AssetRecord[]> {
        return assetDB.assets
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .filter((record) => record.updatedAt > sinceUpdatedAt)
            .sortBy('updatedAt');
    }

    // ── Registry (assetRegistry table) ───────────────────────────────

    async getRegistry(id: string): Promise<AssetRegistryRecord | undefined> {
        return assetDB.assetRegistry.get(id);
    }

    async getAllRegistry(scope: DataScope): Promise<AssetRegistryRecord[]> {
        return assetDB.assetRegistry
            .where('[scopeType+scopeId]')
            .equals([scope.scopeType, scope.scopeId])
            .filter((record) => !record.isDeleted)
            .toArray();
    }

    async getRegistryByStatus(
        scope: DataScope,
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]> {
        if (!kinds || kinds.length === 0) {
            return assetDB.assetRegistry
                .where('[scopeType+scopeId+status]')
                .equals([scope.scopeType, scope.scopeId, status])
                .filter((r) => !r.isDeleted)
                .toArray();
        }

        const keys = kinds.map((k) => [scope.scopeType, scope.scopeId, status, k]);
        return assetDB.assetRegistry
            .where('[scopeType+scopeId+status+kind]')
            .anyOf(keys)
            .filter((r) => !r.isDeleted)
            .toArray();
    }

    async getAllRegistryByStatus(
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]> {
        if (!kinds || kinds.length === 0) {
            return assetDB.assetRegistry
                .where('status')
                .equals(status)
                .filter((record) => !record.isDeleted)
                .toArray();
        }

        const keys = kinds.map((kind) => [status, kind]);
        return assetDB.assetRegistry
            .where('[status+kind]')
            .anyOf(keys)
            .filter((record) => !record.isDeleted)
            .toArray();
    }

    async putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assetRegistry.put(record);
        this.emitWriteEvent('assetRegistry', 'put', [record.id], options);
    }

    async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
        await assetDB.assetRegistry.delete(id);
        this.emitWriteEvent('assetRegistry', 'delete', [id], options);
    }

    async transaction<R>(
        tables: AssetTableName[],
        mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R> {
        await this.flush();
        return assetDB.transaction(mode, tables, callback);
    }
}

export const webAsset = new WebAssetAdapter();
