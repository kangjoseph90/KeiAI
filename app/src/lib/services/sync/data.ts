/**
 * Data Sync Service
 *
 * Handles blind synchronization of encrypted application data (characters,
 * chats, messages, settings, etc.) with PocketBase.
 *
 * - Pull: PocketBase Realtime subscription (SSE, push-based) for live updates
 *         + paged catch-up pull on boot / reconnect (offline gap recovery)
 * - Push: event-driven, triggered from local DB write events after local mutations
 *
 * The server never decrypts or inspects any data.
 *
 * Profile data has its own sync service (ProfileSyncService) because it is
 * NOT E2EE and uses PB file fields, not encrypted blobs.
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '../session';
import { toBase64, fromBase64 } from '$lib/crypto';
import {
    localDB,
    type TableName,
    SYNC_TABLES,
    type BaseRecord,
    type DatabaseWriteEvent
} from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';
import { BaseSyncEngine } from './base';
import { createLogger } from '$lib/adapters/logger';

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

const logger = createLogger('sync:data');

export class DataSyncEngine extends BaseSyncEngine {
    // ─── State ────────────────────────────────────────────────────────
    private subscribed = false;

    constructor() {
        super();
    }

    private readonly PAGE_SIZE = 200;

    private readonly ALLOWED_RECORD_FIELDS = new Set([
        'id',
        'userId',
        'createdAt',
        'updatedAt',
        'isDeleted',
        'encryptedData',
        'encryptedDataIV',
        'characterId',
        'chatId',
        'sortOrder',
        'ownerId'
    ]);

    // ─── Realtime Subscriptions ───────────────────────────────────────

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid) return;
        let isGuest: boolean;
        try {
            ({ isGuest } = getActiveSession());
        } catch {
            return; // session not initialized yet
        }
        if (isGuest || this.subscribed) return;

        for (const table of SYNC_TABLES) {
            await pb.collection(table).subscribe('*', (e) => {
                void this.handleRealtimeEvent(table, e as unknown as RealtimeEvent);
            });
        }
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
        if (!this.subscribed) return;
        for (const table of SYNC_TABLES) {
            try {
                await pb.collection(table).unsubscribe('*');
            } catch {
                /* ignore */
            }
        }
        this.subscribed = false;
    }

    // ─── Cursor Management ───────────────────────────────────────────

    /**
     * Wipe all per-table sync cursors for a user.
     * Call this when there is no existing local user record (fresh install or
     * post-IDB-wipe login) so the next syncAll() fetches everything from scratch.
     */
    async resetCursors(userId: string): Promise<void> {
        for (const table of SYNC_TABLES) {
            await appKV.remove(`lastSync_${table}_${userId}`);
        }
    }

    // ─── Catch-up Pull (boot + fallback poll) ─────────────────────────

    /**
     * Deduplicated full pull. Called on boot and by the 5-minute fallback timer.
     * Downloads all server-side changes since the last cursor, applies LWW, and
     * pushes corrections for records where local is newer (written offline).
     */
    async syncAll(): Promise<void> {
        await this.trigger();
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid) return;
        let userId: string;
        let isGuest: boolean;
        try {
            ({ userId, isGuest } = getActiveSession());
        } catch {
            return; // session not initialized yet
        }
        if (isGuest) return;

        let firstError: unknown = null;

        for (const [index, table] of SYNC_TABLES.entries()) {
            this.updateStatus({
                progress: {
                    completed: index,
                    total: SYNC_TABLES.length,
                    currentItemId: table
                }
            });

            try {
                await this.pullTable(table, userId);
                this.updateStatus({
                    progress: {
                        completed: index + 1,
                        total: SYNC_TABLES.length,
                        currentItemId: table
                    }
                });
            } catch (error) {
                firstError ??= error;
            }
        }

        if (firstError) {
            throw firstError;
        }
    }

    /** Paged pull: fetches server changes since cursor in PAGE_SIZE batches. */
    private async pullTable(tableName: TableName, userId: string): Promise<void> {
        const syncKey = `lastSync_${tableName}_${userId}`;
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let page = 1;
        let syncError: unknown = null;
        // Records where the local version is newer than what the server returned.
        // Accumulated across all pages and pushed as a single batch after the pull.
        const offlineWrites: BaseRecord[] = [];

        try {
            while (true) {
                const result = await pb.collection(tableName).getList(page, this.PAGE_SIZE, {
                    filter: pb.filter('userId = {:userId} && updatedAt >= {:since}', {
                        userId,
                        since: lastSyncTime
                    }),
                    sort: 'updatedAt'
                });

                for (const serverRecord of result.items) {
                    const remote = this.pbToLocalRecord(
                        serverRecord as unknown as Record<string, unknown>
                    );
                    const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
                    const remoteAt = remote.updatedAt ?? 0;
                    const localAt = local?.updatedAt ?? 0;

                    if (!local || remoteAt > localAt) {
                        await localDB.putRecord(tableName, remote, { origin: 'sync' });
                        nextCursor = Math.max(nextCursor, remoteAt);
                    } else if (remoteAt < localAt) {
                        offlineWrites.push(local);
                        nextCursor = Math.max(nextCursor, localAt);
                    } else {
                        nextCursor = Math.max(nextCursor, remoteAt);
                    }
                }

                if (result.page >= result.totalPages) break;
                page++;
            }
        } catch (err) {
            cursorSafeToAdvance = false;
            syncError = err;
            logger.error(`Failed to pull ${tableName}`, err);
        }

        if (cursorSafeToAdvance && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        // Push locally-newer records as a single atomic batch transaction.
        // Fire-and-forget: consistent with other push paths; errors are logged.
        if (offlineWrites.length > 0) {
            void this.pushBatch(tableName, offlineWrites);
        }

        if (syncError) {
            throw syncError;
        }
    }

    /**
     * Push multiple records of the same table to PocketBase as a single atomic batch
     * transaction. Uses upsert so each record is created or updated as needed.
     * If any record in the batch fails (e.g. validation), the entire batch is rolled
     * back by PocketBase, preserving data consistency.
     * Fire-and-forget: errors are logged but never thrown.
     */
    private async pushBatch(tableName: TableName, records: BaseRecord[]): Promise<void> {
        const batch = pb.createBatch();
        for (const record of records) {
            batch.collection(tableName).upsert(this.localToPbRecord(record));
        }
        try {
            await batch.send();
        } catch (err) {
            logger.error(`Failed to push corrections batch to ${tableName}`, err);
        }
    }

    // ─── Realtime Event Handler ───────────────────────────────────────

    /** Apply a single realtime event pushed by PocketBase. */
    private async handleRealtimeEvent(tableName: TableName, e: RealtimeEvent): Promise<void> {
        try {
            const remote = this.pbToLocalRecord(e.record);
            const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
            const remoteAt = remote.updatedAt ?? 0;
            const localAt = local?.updatedAt ?? 0;

            if (!local || remoteAt > localAt) {
                await localDB.putRecord(tableName, remote, { origin: 'sync' });
            } else if (remoteAt < localAt) {
                void this.pushRecord(tableName, local);
            }
        } catch (err) {
            logger.error(`Realtime event error for ${tableName}`, err);
        }
    }

    // ─── Push API (called by service layer) ───────────────────────────

    /**
     * Push a single record to PocketBase via the batch API.
     * - isNew = true  → create (record is guaranteed not to exist yet)
     * - isNew = false → upsert (server creates or updates as needed)
     * Fire-and-forget: errors are logged but never thrown.
     */
    async pushRecord(tableName: TableName, record: BaseRecord, isNew = false): Promise<void> {
        if (!pb.authStore.isValid) return;
        try {
            const { isGuest } = getActiveSession();
            if (isGuest) return;
        } catch {
            return;
        }

        const payload = this.localToPbRecord(record);
        const batch = pb.createBatch();

        if (isNew) {
            batch.collection(tableName).create(payload);
        } else {
            batch.collection(tableName).upsert(payload);
        }

        try {
            await batch.send();
        } catch (err) {
            logger.error(`Failed to push ${record.id} to ${tableName}`, err);
        }
    }

    /**
     * Read a record from local DB and push it to the server.
     * Convenience wrapper for after softDeleteRecord() calls.
     */
    async pushById(tableName: TableName, id: string): Promise<void> {
        const record = await localDB.getRecord<BaseRecord>(tableName, id);
        if (record) void this.pushRecord(tableName, record);
    }

    async handleLocalWrite(event: DatabaseWriteEvent): Promise<void> {
        if (event.origin !== 'local' || !SYNC_TABLES.includes(event.tableName)) return;
        if (event.operation === 'delete' || event.operation === 'deleteByIndex') return;

        for (const id of event.ids) {
            void this.pushById(event.tableName, id);
        }
    }

    /**
     * Push all records modified at or after `sinceInclusive` across all sync tables
     * as a single batch transaction.
     * Called by the service layer after cascade-delete transactions.
     */
    async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
        if (!pb.authStore.isValid) return;
        try {
            const { isGuest } = getActiveSession();
            if (isGuest) return;
        } catch {
            return;
        }

        const batch = pb.createBatch();
        let hasItems = false;

        for (const table of SYNC_TABLES) {
            const changed = await localDB.getUnsyncedChanges(table, userId, sinceInclusive - 1);
            if (changed.length > 0) {
                hasItems = true;
                for (const record of changed) {
                    batch.collection(table).upsert(this.localToPbRecord(record));
                }
            }
        }

        if (!hasItems) return;

        try {
            await batch.send();
        } catch (err) {
            logger.error('Failed to push recent writes batch', err);
        }
    }

    // ─── Serialization ────────────────────────────────────────────────

    private localToPbRecord(record: BaseRecord): Record<string, unknown> {
        const payload = { ...record } as Record<string, unknown>;
        for (const key of Object.keys(payload)) {
            if (payload[key] instanceof Uint8Array) {
                payload[key] = toBase64(payload[key] as Uint8Array<ArrayBuffer>);
            }
        }
        return payload;
    }

    private pbToLocalRecord(pbRecord: Record<string, unknown>): BaseRecord {
        const record: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(pbRecord)) {
            if (!this.ALLOWED_RECORD_FIELDS.has(key)) continue;
            record[key] =
                typeof value === 'string' && this.isBase64ByteField(key)
                    ? fromBase64(value)
                    : value;
        }

        record.createdAt = this.normalizeTimestamp(record.createdAt, pbRecord.created);
        record.updatedAt = this.normalizeTimestamp(record.updatedAt, pbRecord.updated);
        record.isDeleted = Boolean(record.isDeleted);

        return record as unknown as BaseRecord;
    }

    private readonly BYTE_FIELD_NAMES = new Set(['encryptedData', 'encryptedDataIV', 'masterKey']);

    private isBase64ByteField(fieldName: string): boolean {
        return this.BYTE_FIELD_NAMES.has(fieldName);
    }
}

export const DataSyncService = new DataSyncEngine();
