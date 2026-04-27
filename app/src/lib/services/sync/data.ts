/**
 * Data Sync Service
 *
 * Handles blind synchronization of application data (characters,
 * chats, messages, settings, etc.) with PocketBase.
 *
 * - Pull: PocketBase Realtime subscription (SSE, push-based) for live updates
 *         + paged catch-up pull on boot / reconnect (offline gap recovery)
 * - Push: event-driven, triggered from local DB write events after local mutations
 *
 * The server never decrypts or inspects any data.
 * Encryption/decryption happens ONLY at this sync boundary.
 *
 * Profile data has its own sync service (ProfileSyncService) because it is
 * NOT E2EE and uses PB file fields, not encrypted blobs.
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession, hasActiveSession } from '../session';
import { encrypt, decrypt, toBase64, fromBase64 } from '$lib/crypto';
import {
    localDB,
    type TableName,
    SYNC_TABLES,
    type BaseRecord,
    type DataRecord,
    type DatabaseWriteEvent
} from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';
import { BaseSyncEngine } from './base';
import { createLogger } from '$lib/adapters/logger';
import { isErrorCode } from '$lib/types/errors';
import { Semaphore } from '$lib/utils/semaphore';

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

const logger = createLogger('sync:data');

export class DataSyncEngine extends BaseSyncEngine {
    // ─── State ────────────────────────────────────────────────────────
    private subscribed = false;
    private syncing = false;
    private pendingQueue: Array<() => Promise<void>> = [];

    private readonly PAGE_SIZE = 200;
    private readonly TABLE_CONCURRENCY = 4;

    constructor() {
        super();
    }

    // ─── Realtime Subscriptions ───────────────────────────────────────

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        // Ensure clean state before subscribing to avoid duplicate handlers
        await this.unsubscribeRealtime();

        try {
            for (const table of SYNC_TABLES) {
                await pb.collection(table).subscribe('*', (e) => {
                    void this.handleRealtimeEvent(table, e as unknown as RealtimeEvent);
                });
            }
        } catch (err) {
            await this.unsubscribeRealtime();
            throw err;
        }
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
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
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId } = getActiveSession();

        this.syncing = true;
        let firstError: unknown = null;
        let completed = 0;

        try {
            const semaphore = new Semaphore(this.TABLE_CONCURRENCY);
            const results = await Promise.allSettled(
                SYNC_TABLES.map((table) =>
                    semaphore.runExclusive(async () => {
                        await this.pullTable(table, userId);
                        completed++;
                        this.updateStatus({
                            progress: {
                                completed,
                                total: SYNC_TABLES.length,
                                currentItemId: table
                            }
                        });
                    })
                )
            );

            for (const result of results) {
                if (result.status === 'rejected') {
                    firstError ??= result.reason;
                }
            }
        } finally {
            this.syncing = false;
            void this.flushPendingQueue();
        }

        if (firstError) {
            throw firstError;
        }
    }

    /** Flush all push tasks queued during a syncAll run. */
    private async flushPendingQueue(): Promise<void> {
        const tasks = this.pendingQueue.splice(0);
        for (const task of tasks) {
            await task();
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
        let correctionError: unknown = null;
        // Records where the local version is newer than what the server returned.
        // Accumulated across all pages and pushed as a single batch after the pull.
        const offlineWrites: DataRecord[] = [];

        try {
            while (true) {
                const result = await pb.collection(tableName).getList(page, this.PAGE_SIZE, {
                    filter: pb.filter('userId = {:userId} && updatedAt >= {:since}', {
                        userId,
                        since: lastSyncTime
                    }),
                    sort: 'updatedAt'
                });

                if (result.items.length > 0) {
                    const toUpsert: DataRecord[] = [];

                    const remotes = await Promise.all(
                        result.items.map((serverRecord) =>
                            this.pbToLocalRecord(serverRecord as unknown as Record<string, unknown>)
                        )
                    );

                    const pairedRecords = await Promise.all(
                        remotes.map(async (remote) => ({
                            remote,
                            local: await localDB.getRecord<DataRecord>(tableName, remote.id)
                        }))
                    );

                    for (const { remote, local } of pairedRecords) {
                        const remoteAt = remote.updatedAt ?? 0;
                        const localAt = local?.updatedAt ?? 0;

                        if (!local || remoteAt > localAt) {
                            toUpsert.push(remote);
                        } else if (remoteAt < localAt) {
                            offlineWrites.push(local);
                        }
                        nextCursor = Math.max(nextCursor, remoteAt);
                    }

                    if (toUpsert.length > 0) {
                        await localDB.putRecords(tableName, toUpsert, { origin: 'sync' });
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

        // Push locally-newer records (offline writes).
        // Scan from one tick before the cursor so same-ms local writes on the
        // cursor boundary cannot be hidden after a failed fire-and-forget push.
        const scannedUnsynced = await localDB.getUnsyncedChanges<DataRecord>(
            tableName,
            userId,
            lastSyncTime - 1
        );
        const pendingPushes = new Map<string, DataRecord>();
        for (const record of offlineWrites) pendingPushes.set(record.id, record);
        for (const record of scannedUnsynced) pendingPushes.set(record.id, record);
        const unsynced = [...pendingPushes.values()];
        if (unsynced.length > 0) {
            try {
                // Throw on failure so cursorSafeToAdvance remains false if push fails
                await this.pushBatch(tableName, unsynced, false);
            } catch (err) {
                correctionError = err;
            }
        }

        if (cursorSafeToAdvance && !correctionError && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        if (syncError) {
            throw syncError;
        }

        if (correctionError) {
            throw correctionError;
        }
    }

    /**
     * Push multiple records of the same table to PocketBase as a single atomic batch
     * transaction. Uses upsert so each record is created or updated as needed.
     * If any record in the batch fails (e.g. validation), the entire batch is rolled
     * back by PocketBase, preserving data consistency.
     * Default behavior keeps fire-and-forget semantics; callers can opt into throw-on-failure.
     */
    private async pushBatch(
        tableName: TableName,
        records: DataRecord[],
        swallowErrors = true
    ): Promise<void> {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                batch.collection(tableName).upsert(await this.localToPbRecord(record));
            }
            try {
                await batch.send({ requestKey: null });
            } catch (err) {
                logger.error(`Failed to push corrections batch to ${tableName}`, err);
                if (!swallowErrors) {
                    throw err;
                }
            }
        }
    }

    // ─── Realtime Event Handler ───────────────────────────────────────

    /** Apply a single realtime event pushed by PocketBase. */
    private async handleRealtimeEvent(tableName: TableName, e: RealtimeEvent): Promise<void> {
        try {
            const remote = await this.pbToLocalRecord(e.record);
            const remoteAt = remote.updatedAt ?? 0;

            // Atomic LWW check and write via transaction to avoid race conditions
            await localDB.transaction([tableName], 'rw', async () => {
                const local = await localDB.getRecord<DataRecord>(tableName, remote.id);
                const localAt = local?.updatedAt ?? 0;

                if (!local || remoteAt > localAt) {
                    await localDB.putRecord(tableName, remote, { origin: 'sync' });
                } else if (remoteAt < localAt) {
                    // Local is newer: push back to server (background fire-and-forget)
                    void this.pushRecord(tableName, local);
                }
            });
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
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const payload = await this.localToPbRecord(record);
        const batch = pb.createBatch();

        if (isNew) {
            batch.collection(tableName).create(payload);
        } else {
            batch.collection(tableName).upsert(payload);
        }

        try {
            await batch.send({ requestKey: null });
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

    /**
     * Handle a local DB write event by batching all IDs into a single push.
     * Filters out non-local origins, deletions, and non-sync tables.
     */
    async handleLocalWrite(event: DatabaseWriteEvent): Promise<void> {
        if (event.origin !== 'local' || !SYNC_TABLES.includes(event.tableName)) return;
        if (event.operation === 'delete' || event.operation === 'deleteByIndex') return;
        if (event.ids.length === 0) return;

        const task = () => this.pushIds(event.tableName, event.ids);
        if (this.syncing) {
            // Defer until syncAll completes to avoid concurrent push conflicts
            this.pendingQueue.push(task);
        } else {
            void task();
        }
    }

    /**
     * Batch-push multiple record IDs in a single HTTP request.
     * Reads all records from local DB, then sends as one PocketBase batch.
     */
    private async pushIds(tableName: TableName, ids: string[]): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const records = await Promise.all(
            ids.map((id) => localDB.getRecord<DataRecord>(tableName, id))
        );
        const existing = records.filter((r): r is DataRecord => r !== undefined);
        if (existing.length === 0) return;

        await this.pushBatch(tableName, existing);
    }

    /**
     * Push all records modified at or after `sinceInclusive` across all sync tables
     * as a single batch transaction.
     * Called by the service layer after cascade-delete transactions.
     */
    async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const allChanges: { table: TableName; record: BaseRecord }[] = [];

        for (const table of SYNC_TABLES) {
            const changed = await localDB.getUnsyncedChanges(table, userId, sinceInclusive - 1);
            for (const record of changed) {
                allChanges.push({ table, record });
            }
        }

        if (allChanges.length === 0) return;

        const CHUNK_SIZE = 100;
        for (let i = 0; i < allChanges.length; i += CHUNK_SIZE) {
            const chunk = allChanges.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const { table, record } of chunk) {
                batch.collection(table).upsert(await this.localToPbRecord(record));
            }
            try {
                await batch.send();
            } catch (err) {
                logger.error('Failed to push recent writes batch', err);
            }
        }
    }

    // ─── Serialization ────────────────────────────────────────────────

    private async localToPbRecord(record: BaseRecord): Promise<Record<string, unknown>> {
        const { masterKey } = getActiveSession();
        const { id, userId, createdAt, updatedAt, isDeleted, ...rest } = record;
        const { ciphertext, iv } = await encrypt(masterKey, JSON.stringify(rest));

        return {
            id,
            userId,
            createdAt,
            updatedAt,
            isDeleted,
            encryptedData: toBase64(ciphertext),
            encryptedDataIV: toBase64(iv)
        };
    }

    private async pbToLocalRecord(pbRecord: Record<string, unknown>): Promise<DataRecord> {
        const { masterKey } = getActiveSession();
        const encData = fromBase64(pbRecord.encryptedData as string);
        const encIV = fromBase64(pbRecord.encryptedDataIV as string);
        const json = await decrypt(masterKey, { ciphertext: encData, iv: encIV });
        const payload = JSON.parse(json) as Record<string, unknown>;

        return {
            ...payload,
            id: pbRecord.id as string,
            userId: pbRecord.userId as string,
            createdAt: this.normalizeTimestamp(pbRecord.createdAt, pbRecord.created),
            updatedAt: this.normalizeTimestamp(pbRecord.updatedAt, pbRecord.updated),
            isDeleted: Boolean(pbRecord.isDeleted)
        } as DataRecord;
    }

    protected override isAuthError(error: unknown): boolean {
        if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
            return true;
        }

        const status = (error as { status?: unknown })?.status;
        return status === 401 || status === 403;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;

        const status = (error as { status?: unknown })?.status;
        return status === 402 || status === 413;
    }
}

export const DataSyncService = new DataSyncEngine();
