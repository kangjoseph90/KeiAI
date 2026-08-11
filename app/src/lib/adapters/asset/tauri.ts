import Database from '@tauri-apps/plugin-sql';
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
import type { DataScope, DataScopeType, TableName } from '$lib/adapters/db';
import type { AssetStatus } from '$lib/types/asset';

/**
 * Tauri Local Asset Store
 *
 * SQLite stores local asset registry metadata. appStorage owns local blobs, but
 * this adapter hides /assets paths so callers cannot update metadata and blobs
 * independently.
 */

interface RegistrySqlRow {
    id: string;
    scopeType: string;
    scopeId: string;
    ownerTable: string;
    ownerId: string;
    hash: string;
    encKey: string;
    status: string;
    size: number;
    accessedAt: number;
}

function storagePath(id: string): string {
    return `assets/${encodeURIComponent(id)}`;
}

function parseRegistryRecord(row: RegistrySqlRow): AssetRegistryRecord {
    return {
        id: row.id,
        scopeType: row.scopeType as DataScopeType,
        scopeId: row.scopeId,
        ownerTable: row.ownerTable as TableName,
        ownerId: row.ownerId,
        hash: row.hash,
        encKey: row.encKey,
        status: row.status as AssetStatus,
        size: row.size,
        accessedAt: row.accessedAt
    };
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

export class TauriAssetAdapter implements IAssetAdapter {
    private dbPromise: Promise<Database> | null = null;
    private inTransaction = false;

    async flush(): Promise<void> {
        return Promise.resolve();
    }

    private async getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = (async () => {
            const db = await Database.load('sqlite:KeiLocalDB.db');
            await this.initDb(db);
            return db;
        })();

        return this.dbPromise;
    }

    private async initDb(db: Database): Promise<void> {
        let sql = '';
        sql += `
            CREATE TABLE IF NOT EXISTS assetRegistry (
                id TEXT PRIMARY KEY,
                scopeType TEXT NOT NULL,
                scopeId TEXT NOT NULL,
                ownerTable TEXT NOT NULL,
                ownerId TEXT NOT NULL,
                hash TEXT NOT NULL,
                encKey TEXT NOT NULL,
                status TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                accessedAt INTEGER NOT NULL
            );
        `;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope ON assetRegistry (scopeType, scopeId);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_owner ON assetRegistry (scopeType, scopeId, ownerTable, ownerId);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_owner_hash ON assetRegistry (scopeType, scopeId, ownerTable, ownerId, hash);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_status ON assetRegistry (status);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_status_accessedAt ON assetRegistry (status, accessedAt);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope_status ON assetRegistry (scopeType, scopeId, status);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope_status_accessedAt ON assetRegistry (scopeType, scopeId, status, accessedAt);`;

        await db.execute(sql);
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
            const db = await this.getDb();
            await this.putRecord(db, record);
        } catch (error) {
            await appStorage.delete(storagePath(record.id)).catch(() => undefined);
            throw error;
        }
        return record;
    }

    private async putRecord(db: Database, record: AssetRegistryRecord): Promise<void> {
        await db.execute(
            `INSERT OR REPLACE INTO assetRegistry
                (id, scopeType, scopeId, ownerTable, ownerId, hash, encKey, status, size, accessedAt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                record.id,
                record.scopeType,
                record.scopeId,
                record.ownerTable,
                record.ownerId,
                record.hash,
                record.encKey,
                record.status,
                record.size,
                record.accessedAt
            ]
        );
    }

    async getAsset(locator: AssetLocator): Promise<AssetRegistryRecord | undefined> {
        const db = await this.getDb();
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry WHERE id = $1 LIMIT 1`,
            [assetRegistryId(locator)]
        );
        if (rows.length > 0) return parseRegistryRecord(rows[0]);
        return undefined;
    }

    async deleteAsset(locator: AssetLocator): Promise<void> {
        await this.deleteByIds([assetRegistryId(locator)]);
    }

    async deleteOwnerAssets(owner: AssetOwner): Promise<void> {
        const db = await this.getDb();
        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM assetRegistry
             WHERE scopeType = $1 AND scopeId = $2 AND ownerTable = $3 AND ownerId = $4`,
            [owner.scopeType, owner.scopeId, owner.ownerTable, owner.ownerId]
        );
        await this.deleteByIds(rows.map((row) => row.id));
    }

    async deleteScopeAssets(scope: DataScope): Promise<void> {
        const db = await this.getDb();
        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM assetRegistry WHERE scopeType = $1 AND scopeId = $2`,
            [scope.scopeType, scope.scopeId]
        );
        await this.deleteByIds(rows.map((row) => row.id));
    }

    private async deleteByIds(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        const db = await this.getDb();
        await this.withDbTransaction(async () => {
            for (const id of ids) {
                await db.execute(`DELETE FROM assetRegistry WHERE id = $1`, [id]);
            }
        });
        await Promise.all(
            ids.map((id) => appStorage.delete(storagePath(id)).catch(() => undefined))
        );
    }

    async getAllLocalAssets(scope: DataScope): Promise<AssetRegistryRecord[]> {
        return this.getAllByStatus(scope, 'local');
    }

    async getAllRemoteAssets(scope?: DataScope): Promise<AssetRegistryRecord[]> {
        if (!scope) {
            const db = await this.getDb();
            const rows = await db.select<RegistrySqlRow[]>(
                `SELECT * FROM assetRegistry WHERE status = $1 ORDER BY accessedAt ASC`,
                ['remote']
            );
            return rows.map((row) => parseRegistryRecord(row));
        }
        return this.getAllByStatus(scope, 'remote');
    }

    private async getAllByStatus(
        scope: DataScope,
        status: AssetStatus
    ): Promise<AssetRegistryRecord[]> {
        const db = await this.getDb();
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry
             WHERE scopeType = $1 AND scopeId = $2 AND status = $3
             ORDER BY accessedAt ASC`,
            [scope.scopeType, scope.scopeId, status]
        );
        return rows.map((row) => parseRegistryRecord(row));
    }

    async readAssetBytes(locator: AssetLocator): Promise<Uint8Array | null> {
        return appStorage.read(storagePath(assetRegistryId(locator)));
    }

    async hasAsset(locator: AssetLocator): Promise<boolean> {
        return appStorage.exists(storagePath(assetRegistryId(locator)));
    }

    async getRenderUrl(locator: AssetLocator): Promise<string | null> {
        return appStorage.getRenderUrl(storagePath(assetRegistryId(locator)));
    }

    async revokeRenderUrl(url: string): Promise<void> {
        await appStorage.revokeRenderUrl(url);
    }

    async touchAsset(locator: AssetLocator): Promise<void> {
        await this.updateAssets([locator], undefined);
    }

    async markAssetRemote(locator: AssetLocator): Promise<void> {
        await this.updateAssets([locator], 'remote');
    }

    async markAssetLocal(locator: AssetLocator): Promise<void> {
        await this.updateAssets([locator], 'local');
    }

    async markAssetsRemote(locators: AssetLocator[]): Promise<void> {
        await this.updateAssets(locators, 'remote');
    }

    async markAssetsLocal(locators: AssetLocator[]): Promise<void> {
        await this.updateAssets(locators, 'local');
    }

    private async updateAssets(
        locators: AssetLocator[],
        status: AssetStatus | undefined
    ): Promise<string[]> {
        const ids = locators.map((locator) => assetRegistryId(locator));
        if (ids.length === 0) return [];

        const db = await this.getDb();
        const changed: string[] = [];
        const now = clock.now();

        await this.withDbTransaction(async () => {
            for (const id of ids) {
                const rows = await db.select<RegistrySqlRow[]>(
                    `SELECT * FROM assetRegistry WHERE id = $1 LIMIT 1`,
                    [id]
                );
                if (rows.length === 0) continue;

                const existing = parseRegistryRecord(rows[0]);
                const nextStatus = status ?? existing.status;
                if (existing.status === nextStatus && existing.accessedAt === now) continue;

                await this.putRecord(db, {
                    ...existing,
                    status: nextStatus,
                    accessedAt: now
                });
                changed.push(id);
            }
        });

        return changed;
    }

    async transaction<R>(callback: () => Promise<R>): Promise<R> {
        await this.flush();
        return this.withDbTransaction(callback);
    }

    private async withDbTransaction<R>(callback: () => Promise<R>): Promise<R> {
        if (this.inTransaction) {
            return await callback();
        }

        const db = await this.getDb();
        this.inTransaction = true;
        await db.execute('BEGIN TRANSACTION');
        try {
            const result = await callback();
            await db.execute('COMMIT');
            return result;
        } catch (error) {
            await db.execute('ROLLBACK');
            throw error;
        } finally {
            this.inTransaction = false;
        }
    }
}
