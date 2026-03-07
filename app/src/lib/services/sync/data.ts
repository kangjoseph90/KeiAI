/**
 * Data Sync Service
 *
 * Handles blind synchronization of encrypted application data (characters,
 * chats, messages, settings, etc.) with PocketBase.
 *
 * - Pull: PocketBase Realtime subscription (SSE, push-based) for live updates
 *         + paged catch-up pull on boot / reconnect (offline gap recovery)
 * - Push: event-driven, called by the service layer after every local write
 *
 * The server never decrypts or inspects any data.
 *
 * Profile data has its own sync service (ProfileSyncService) because it is
 * NOT E2EE and uses PB file fields, not encrypted blobs.
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '../session';
import { toBase64, fromBase64 } from '$lib/crypto';
import { localDB, type TableName, SYNC_TABLES, type BaseRecord } from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';

type RealtimeEvent = {
	action: string;
	record: Record<string, unknown>;
};

export class DataSyncService {
	// ─── State ────────────────────────────────────────────────────────
	private static syncPromise: Promise<void> | null = null;
	private static subscribed = false;

	private static readonly PAGE_SIZE = 200;

	private static readonly ALLOWED_RECORD_FIELDS = new Set([
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

	static get isSubscribed(): boolean {
		return this.subscribed;
	}

	static async subscribeRealtime(): Promise<void> {
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

	static async unsubscribeRealtime(): Promise<void> {
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
	static async resetCursors(userId: string): Promise<void> {
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
	static async syncAll(): Promise<void> {
		if (this.syncPromise) return this.syncPromise;
		this.syncPromise = this.pullAll().finally(() => {
			this.syncPromise = null;
		});
		return this.syncPromise;
	}

	private static async pullAll(): Promise<void> {
		if (!pb.authStore.isValid) return;
		let userId: string;
		let isGuest: boolean;
		try {
			({ userId, isGuest } = getActiveSession());
		} catch {
			return; // session not initialized yet
		}
		if (isGuest) return;

		for (const table of SYNC_TABLES) {
			await this.pullTable(table, userId);
		}
	}

	/** Paged pull: fetches server changes since cursor in PAGE_SIZE batches. */
	private static async pullTable(tableName: TableName, userId: string): Promise<void> {
		const syncKey = `lastSync_${tableName}_${userId}`;
		const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
		let nextCursor = lastSyncTime;
		let cursorSafeToAdvance = true;
		let page = 1;

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
					const remote = this.pbToLocalRecord(serverRecord as unknown as Record<string, unknown>);
					const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
					const remoteAt = remote.updatedAt ?? 0;
					const localAt = local?.updatedAt ?? 0;

					if (!local || remoteAt > localAt) {
						await localDB.putRecord(tableName, remote);
						nextCursor = Math.max(nextCursor, remoteAt);
					} else if (remoteAt < localAt) {
						void this.pushRecord(tableName, local);
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
			console.error(`Failed to pull ${tableName}`, err);
		}

		if (cursorSafeToAdvance && nextCursor > lastSyncTime) {
			await appKV.set(syncKey, nextCursor.toString());
		}
	}

	// ─── Realtime Event Handler ───────────────────────────────────────

	/** Apply a single realtime event pushed by PocketBase. */
	private static async handleRealtimeEvent(tableName: TableName, e: RealtimeEvent): Promise<void> {
		try {
			const remote = this.pbToLocalRecord(e.record);
			const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
			const remoteAt = remote.updatedAt ?? 0;
			const localAt = local?.updatedAt ?? 0;

			if (!local || remoteAt > localAt) {
				await localDB.putRecord(tableName, remote);
			} else if (remoteAt < localAt) {
				void this.pushRecord(tableName, local);
			}
		} catch (err) {
			console.error(`Realtime event error for ${tableName}`, err);
		}
	}

	// ─── Push API (called by service layer) ───────────────────────────

	/**
	 * Push a single record to PocketBase.
	 * - isNew = true  → POST directly (skip PATCH round-trip)
	 * - isNew = false → PATCH first, create on 404
	 * Fire-and-forget: errors are logged but never thrown.
	 */
	static async pushRecord(tableName: TableName, record: BaseRecord, isNew = false): Promise<void> {
		if (!pb.authStore.isValid) return;
		try {
			const { isGuest } = getActiveSession();
			if (isGuest) return;
		} catch {
			return;
		}

		const payload = this.localToPbRecord(record);

		if (isNew) {
			try {
				await pb.collection(tableName).create(payload);
			} catch (err) {
				console.error(`Failed to create ${record.id} in ${tableName}`, err);
			}
			return;
		}

		try {
			await pb.collection(tableName).update(record.id, payload);
		} catch (err) {
			const e = err as { status?: number };
			if (e.status === 404) {
				try {
					await pb.collection(tableName).create(payload);
				} catch (createErr) {
					console.error(`Failed to create ${record.id} in ${tableName}`, createErr);
				}
			} else {
				console.error(`Failed to push ${record.id} to ${tableName}`, err);
			}
		}
	}

	/**
	 * Read a record from local DB and push it to the server.
	 * Convenience wrapper for after softDeleteRecord() calls.
	 */
	static async pushById(tableName: TableName, id: string): Promise<void> {
		const record = await localDB.getRecord<BaseRecord>(tableName, id);
		if (record) void this.pushRecord(tableName, record);
	}

	/**
	 * Push all records modified at or after `sinceInclusive` across all sync tables.
	 * Called by the service layer after cascade-delete transactions.
	 */
	static async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
		if (!pb.authStore.isValid) return;
		try {
			const { isGuest } = getActiveSession();
			if (isGuest) return;
		} catch {
			return;
		}

		for (const table of SYNC_TABLES) {
			const changed = await localDB.getUnsyncedChanges(table, userId, sinceInclusive - 1);
			for (const record of changed) {
				void this.pushRecord(table, record);
			}
		}
	}

	// ─── Serialization ────────────────────────────────────────────────

	private static localToPbRecord(record: BaseRecord): Record<string, unknown> {
		const payload = { ...record } as Record<string, unknown>;
		for (const key of Object.keys(payload)) {
			if (payload[key] instanceof Uint8Array) {
				payload[key] = toBase64(payload[key] as Uint8Array<ArrayBuffer>);
			}
		}
		return payload;
	}

	private static pbToLocalRecord(pbRecord: Record<string, unknown>): BaseRecord {
		const record: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(pbRecord)) {
			if (!this.ALLOWED_RECORD_FIELDS.has(key)) continue;
			record[key] =
				typeof value === 'string' && this.isBase64ByteField(key) ? fromBase64(value) : value;
		}

		record.createdAt = this.normalizeTimestamp(record.createdAt, pbRecord.created);
		record.updatedAt = this.normalizeTimestamp(record.updatedAt, pbRecord.updated);
		record.isDeleted = Boolean(record.isDeleted);

		return record as unknown as BaseRecord;
	}

	private static readonly BYTE_FIELD_NAMES = new Set([
		'encryptedData',
		'encryptedDataIV',
		'masterKey'
	]);

	private static isBase64ByteField(fieldName: string): boolean {
		return this.BYTE_FIELD_NAMES.has(fieldName);
	}

	private static normalizeTimestamp(primary: unknown, fallback: unknown): number {
		if (typeof primary === 'number') return primary;

		if (typeof primary === 'string') {
			const parsed = Number(primary);
			if (!Number.isNaN(parsed)) return parsed;
			const asDate = new Date(primary).getTime();
			if (!Number.isNaN(asDate)) return asDate;
		}

		if (typeof fallback === 'string') {
			const asDate = new Date(fallback).getTime();
			if (!Number.isNaN(asDate)) return asDate;
		}

		return 0;
	}
}
