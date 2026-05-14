import Database from '@tauri-apps/plugin-sql';
import { AssetWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';
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

/**
 * Tauri Asset Adapter
 *
 * SQLite storage for asset metadata (assets, assetRegistry tables).
 * Binary blobs are stored via appStorage (native FS) directly by the service layer.
 *
 * Row structure:
 *   - assets: plaintext metadata record (DataRecord with `data` JSON column)
 *   - assetRegistry: device-local cache metadata only (size, accessedAt)
 */

/** Raw shape of an asset record as stored in SQLite */
interface AssetSqlRow {
    id: string;
    scopeType: string;
    scopeId: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: number; // SQLite uses 0/1 for boolean
    data: string; // JSON.stringify(AssetFields)
}

/** Raw shape of a registry record as stored in SQLite */
interface RegistrySqlRow {
    id: string;
    scopeType: string;
    scopeId: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: number;
    kind: string;
    status: string;
    size: number;
    accessedAt: number;
}

/** Convert AssetRecord to bindings for SQLite */
function assetRecordToBindings(record: AssetRecord): AssetSqlRow {
    return {
        id: record.id,
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted ? 1 : 0,
        data: JSON.stringify(record.data ?? {})
    };
}

/** Parse raw SQLite row back into AssetRecord */
function parseAssetRecord(row: AssetSqlRow): AssetRecord {
    return {
        id: row.id,
        scopeType: row.scopeType as AssetRecord['scopeType'],
        scopeId: row.scopeId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isDeleted: row.isDeleted === 1,
        data: JSON.parse(row.data) as Record<string, unknown>
    };
}

/** Parse raw SQLite row into AssetRegistryRecord */
function parseRegistryRecord(row: RegistrySqlRow): AssetRegistryRecord {
    return {
        id: row.id,
        scopeType: row.scopeType as AssetRegistryRecord['scopeType'],
        scopeId: row.scopeId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isDeleted: row.isDeleted === 1,
        kind: row.kind as AssetKind,
        status: row.status as AssetStatus,
        size: row.size,
        accessedAt: row.accessedAt
    };
}

// ─── Adapter ───────────────────────────────────────────────────────────────

export class TauriAssetAdapter implements IAssetAdapter {
    private dbPromise: Promise<Database> | null = null;
    private readonly writeEvents = new AssetWriteEventEmitter();
    private inTransaction = false;

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

    // ── SQLite ───────────────────────────────────────────────────────────────

    private async getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = (async () => {
            const db = await Database.load('sqlite:KeiLocalDB.db');
            await this.initDb(db);
            return db;
        })();

        return this.dbPromise;
    }

    private async initDb(db: Database) {
        let sql = '';

        // Assets table - plaintext metadata
        sql += `
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                scopeType TEXT NOT NULL,
                scopeId TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                isDeleted INTEGER NOT NULL DEFAULT 0,
                data TEXT
            );
        `;
        sql += `CREATE INDEX IF NOT EXISTS idx_assets_scope ON assets (scopeType, scopeId);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assets_scope_updatedAt ON assets (scopeType, scopeId, updatedAt);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assets_updatedAt ON assets (updatedAt);`;

        // Asset registry table - device-local cache metadata + routing fields
        sql += `
            CREATE TABLE IF NOT EXISTS assetRegistry (
                id TEXT PRIMARY KEY,
                scopeType TEXT NOT NULL,
                scopeId TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                isDeleted INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                accessedAt INTEGER NOT NULL
            );
        `;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope ON assetRegistry (scopeType, scopeId);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope_status ON assetRegistry (scopeType, scopeId, status);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope_status_kind ON assetRegistry (scopeType, scopeId, status, kind);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_scope_isDeleted ON assetRegistry (scopeType, scopeId, isDeleted);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_status ON assetRegistry (status);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_status_kind ON assetRegistry (status, kind);`;
        sql += `CREATE INDEX IF NOT EXISTS idx_assetRegistry_accessedAt ON assetRegistry (accessedAt);`;

        await db.execute(sql);
    }

    // ── Metadata (assets table) ──────────────────────────────────────

    async getAsset(id: string): Promise<AssetRecord | undefined> {
        const db = await this.getDb();
        const rows = await db.select<AssetSqlRow[]>(`SELECT * FROM assets WHERE id = $1`, [id]);
        if (rows.length > 0) return parseAssetRecord(rows[0]);
        return undefined;
    }

    async getAllAssets(scope: DataScope): Promise<AssetRecord[]> {
        const db = await this.getDb();
        const rows = await db.select<AssetSqlRow[]>(
            `SELECT * FROM assets WHERE scopeType = $1 AND scopeId = $2 AND isDeleted = 0 ORDER BY updatedAt ASC`,
            [scope.scopeType, scope.scopeId]
        );
        return rows.map((row) => parseAssetRecord(row));
    }

    async putAsset(record: AssetRecord, options?: AssetWriteOptions): Promise<void> {
        const db = await this.getDb();
        const data = assetRecordToBindings(record);

        await db.execute(
            `INSERT OR REPLACE INTO assets (id, scopeType, scopeId, createdAt, updatedAt, isDeleted, data)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                data.id,
                data.scopeType,
                data.scopeId,
                data.createdAt,
                data.updatedAt,
                data.isDeleted,
                data.data
            ]
        );
        this.emitWriteEvent('assets', 'put', [record.id], options);
    }

    async softDeleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
        const db = await this.getDb();
        const now = clock.now();
        await db.execute(`UPDATE assets SET isDeleted = 1, updatedAt = $1 WHERE id = $2`, [
            now,
            id
        ]);
        this.emitWriteEvent('assets', 'softDelete', [id], options);
    }

    async deleteAsset(id: string, options?: AssetWriteOptions): Promise<void> {
        const db = await this.getDb();
        await db.execute(`DELETE FROM assets WHERE id = $1`, [id]);
        this.emitWriteEvent('assets', 'delete', [id], options);
    }

    async getAssetsSince(scope: DataScope, sinceUpdatedAt: number): Promise<AssetRecord[]> {
        const db = await this.getDb();
        const rows = await db.select<AssetSqlRow[]>(
            `SELECT * FROM assets WHERE scopeType = $1 AND scopeId = $2 AND updatedAt > $3 ORDER BY updatedAt ASC`,
            [scope.scopeType, scope.scopeId, sinceUpdatedAt]
        );
        return rows.map((row) => parseAssetRecord(row));
    }

    // ── Registry (assetRegistry table) ───────────────────────────────

    async getRegistry(id: string): Promise<AssetRegistryRecord | undefined> {
        const db = await this.getDb();
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry WHERE id = $1`,
            [id]
        );
        if (rows.length > 0) return parseRegistryRecord(rows[0]);
        return undefined;
    }

    async getAllRegistry(scope: DataScope): Promise<AssetRegistryRecord[]> {
        const db = await this.getDb();
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry WHERE scopeType = $1 AND scopeId = $2 AND isDeleted = 0`,
            [scope.scopeType, scope.scopeId]
        );
        return rows.map((row) => parseRegistryRecord(row));
    }

    async getRegistryByStatus(
        scope: DataScope,
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]> {
        const db = await this.getDb();
        if (!kinds || kinds.length === 0) {
            const rows = await db.select<RegistrySqlRow[]>(
                `SELECT * FROM assetRegistry WHERE scopeType = $1 AND scopeId = $2 AND status = $3 AND isDeleted = 0`,
                [scope.scopeType, scope.scopeId, status]
            );
            return rows.map((row) => parseRegistryRecord(row));
        }

        const placeholders = kinds.map((_, i) => `$${i + 4}`).join(', ');
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry WHERE scopeType = $1 AND scopeId = $2 AND status = $3 AND isDeleted = 0 AND kind IN (${placeholders})`,
            [scope.scopeType, scope.scopeId, status, ...kinds]
        );
        return rows.map((row) => parseRegistryRecord(row));
    }

    async getAllRegistryByStatus(
        status: AssetStatus,
        kinds?: AssetKind[]
    ): Promise<AssetRegistryRecord[]> {
        const db = await this.getDb();
        if (!kinds || kinds.length === 0) {
            const rows = await db.select<RegistrySqlRow[]>(
                `SELECT * FROM assetRegistry WHERE status = $1 AND isDeleted = 0`,
                [status]
            );
            return rows.map((row) => parseRegistryRecord(row));
        }

        const placeholders = kinds.map((_, i) => `$${i + 2}`).join(', ');
        const rows = await db.select<RegistrySqlRow[]>(
            `SELECT * FROM assetRegistry WHERE status = $1 AND isDeleted = 0 AND kind IN (${placeholders})`,
            [status, ...kinds]
        );
        return rows.map((row) => parseRegistryRecord(row));
    }

    async putRegistry(record: AssetRegistryRecord, options?: AssetWriteOptions): Promise<void> {
        const db = await this.getDb();

        await db.execute(
            `INSERT OR REPLACE INTO assetRegistry (id, scopeType, scopeId, createdAt, updatedAt, isDeleted, kind, status, size, accessedAt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                record.id,
                record.scopeType,
                record.scopeId,
                record.createdAt,
                record.updatedAt,
                record.isDeleted ? 1 : 0,
                record.kind,
                record.status,
                record.size,
                record.accessedAt
            ]
        );
        this.emitWriteEvent('assetRegistry', 'put', [record.id], options);
    }

    async deleteRegistry(id: string, options?: AssetWriteOptions): Promise<void> {
        const db = await this.getDb();
        await db.execute(`DELETE FROM assetRegistry WHERE id = $1`, [id]);
        this.emitWriteEvent('assetRegistry', 'delete', [id], options);
    }

    async transaction<R>(
        _tables: AssetTableName[],
        _mode: 'r' | 'rw',
        callback: () => Promise<R>
    ): Promise<R> {
        if (this.inTransaction) {
            // Already in a transaction, just run the callback
            return await callback();
        }

        await this.flush();
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

export const tauriAsset = new TauriAssetAdapter();
