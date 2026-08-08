import Database from '@tauri-apps/plugin-sql';
import type {
    ISyncCursorAdapter,
    SyncCursorIdentity,
    SyncCursorState,
    SyncCursorStreamQuery,
    SyncCursorUpdate
} from './types';

interface SyncCursorRow {
    serverPullCursor: number;
    localPushCursor: number;
}

export class TauriSyncCursorAdapter implements ISyncCursorAdapter {
    private dbPromise: Promise<Database> | null = null;

    private async getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = (async () => {
            const db = await Database.load('sqlite:KeiLocalDB.db');
            await db.execute(`
                CREATE TABLE IF NOT EXISTS sync_cursors (
                    serverUrl        TEXT    NOT NULL,
                    userId           TEXT    NOT NULL,
                    stream           TEXT    NOT NULL,
                    scopeType        TEXT    NOT NULL,
                    scopeId          TEXT    NOT NULL,
                    serverPullCursor INTEGER NOT NULL DEFAULT 0,
                    localPushCursor  INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (serverUrl, userId, stream, scopeType, scopeId)
                );
                CREATE INDEX IF NOT EXISTS idx_sync_cursors_stream
                    ON sync_cursors (serverUrl, userId, stream);
                CREATE INDEX IF NOT EXISTS idx_sync_cursors_user
                    ON sync_cursors (userId);
            `);
            return db;
        })();

        return this.dbPromise;
    }

    async get(identity: SyncCursorIdentity): Promise<SyncCursorState> {
        const db = await this.getDb();
        const rows = await db.select<SyncCursorRow[]>(
            `SELECT serverPullCursor, localPushCursor
             FROM sync_cursors
             WHERE serverUrl = $1 AND userId = $2 AND stream = $3
               AND scopeType = $4 AND scopeId = $5`,
            [
                identity.serverUrl,
                identity.userId,
                identity.stream,
                identity.scopeType,
                identity.scopeId
            ]
        );
        return {
            serverPullCursor: rows[0]?.serverPullCursor ?? 0,
            localPushCursor: rows[0]?.localPushCursor ?? 0
        };
    }

    async advance(identity: SyncCursorIdentity, update: SyncCursorUpdate): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT INTO sync_cursors
                (serverUrl, userId, stream, scopeType, scopeId, serverPullCursor, localPushCursor)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT(serverUrl, userId, stream, scopeType, scopeId) DO UPDATE SET
                serverPullCursor = MAX(sync_cursors.serverPullCursor, excluded.serverPullCursor),
                localPushCursor = MAX(sync_cursors.localPushCursor, excluded.localPushCursor)`,
            [
                identity.serverUrl,
                identity.userId,
                identity.stream,
                identity.scopeType,
                identity.scopeId,
                update.serverPullCursor ?? 0,
                update.localPushCursor ?? 0
            ]
        );
    }

    async delete(identity: SyncCursorIdentity): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `DELETE FROM sync_cursors
             WHERE serverUrl = $1 AND userId = $2 AND stream = $3
               AND scopeType = $4 AND scopeId = $5`,
            [
                identity.serverUrl,
                identity.userId,
                identity.stream,
                identity.scopeType,
                identity.scopeId
            ]
        );
    }

    async deleteByStream(query: SyncCursorStreamQuery): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `DELETE FROM sync_cursors WHERE serverUrl = $1 AND userId = $2 AND stream = $3`,
            [query.serverUrl, query.userId, query.stream]
        );
    }

    async deleteByUser(userId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute(`DELETE FROM sync_cursors WHERE userId = $1`, [userId]);
    }
}
