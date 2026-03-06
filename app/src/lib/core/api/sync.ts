/**
 * Blind Synchronization Engine
 *
 * - Pull: PocketBase Realtime subscription (SSE, push-based) for live updates
 *         + paged catch-up pull on boot / reconnect (offline gap recovery)
 * - Push: event-driven, called by the service layer after every local write
 *
 * The server never decrypts or inspects any data.
 */

import { pb } from './pb.js';
import { getActiveSession } from '../../session.js';
import { toBase64, fromBase64 } from '../crypto/index.js';
import { localDB, type TableName, type BaseRecord } from '../../adapters/db/index.js';
import { appKV } from '../../adapters/kv/index.js';

type RealtimeEvent = {
	action: string;
	record: Record<string, unknown>;
};

export class SyncService {
	// ─── Lifecycle State ──────────────────────────────────────────────
	private static syncPromise: Promise<void> | null = null;
	private static subscribed = false;
	private static pollTimer: ReturnType<typeof setInterval> | null = null;
	private static onlineListener: (() => void) | null = null;
	private static visibilityListener: (() => void) | null = null;

	private static readonly FALLBACK_POLL_INTERVAL_MS = 300_000;
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

	private static TABLES: TableName[] = [
		'characterSummaries',
		'characterData',
		'chatSummaries',
		'chatData',
		'messages',
		'settings',
		'personas',
		'lorebooks',
		'scripts',
		'modules',
		'plugins',
		'presetSummaries',
		'presetData',
		'assets',
	];

	// ─── Lifecycle ────────────────────────────────────────────────────

	static startAutoSync(): void {
		if (typeof window === 'undefined' || this.pollTimer) return;

		// Realtime subscription: primary pull mechanism
		void this.subscribeRealtime();

		// Fallback poll: catches offline gaps that subscriptions miss
		this.pollTimer = setInterval(() => void this.syncAll(), this.FALLBACK_POLL_INTERVAL_MS);

		this.onlineListener = () => void this.resubscribeAndPull();
		window.addEventListener('online', this.onlineListener);

		this.visibilityListener = () => {
			if (document.visibilityState === 'visible') void this.resubscribeAndPull();
		};
		document.addEventListener('visibilitychange', this.visibilityListener);
	}

	static stopAutoSync(): void {
		void this.unsubscribeRealtime();
		if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
		if (typeof window !== 'undefined') {
			if (this.onlineListener) { window.removeEventListener('online', this.onlineListener); this.onlineListener = null; }
			if (this.visibilityListener) { document.removeEventListener('visibilitychange', this.visibilityListener); this.visibilityListener = null; }
		}
	}

	/**
	 * Wipe all per-table sync cursors for a user.
	 * Call this when there is no existing local user record (fresh install or
	 * post-IDB-wipe login) so the next syncAll() fetches everything from scratch.
	 */
	static async resetCursors(userId: string): Promise<void> {
		for (const table of this.TABLES) {
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
		this.syncPromise = this.pullAll().finally(() => { this.syncPromise = null; });
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

		for (const table of this.TABLES) {
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
					filter: pb.filter('userId = {:userId} && updatedAt > {:since}', { userId, since: lastSyncTime }),
					sort: 'updatedAt'
				});

				for (const serverRecord of result.items) {
					const remote = this.pbToLocalRecord(serverRecord as unknown as Record<string, unknown>);
					const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
					const remoteAt = remote.updatedAt ?? 0;
					const localAt = local?.updatedAt ?? 0;

					if (!local || remoteAt > localAt) {
						// Remote is newer — accept it
						await localDB.putRecord(tableName, remote);
						nextCursor = Math.max(nextCursor, remoteAt);
					} else if (remoteAt < localAt) {
						// Local is newer (written offline) — push correction to server
						void this.pushRecord(tableName, local);
						nextCursor = Math.max(nextCursor, localAt);
					} else {
						// Equal timestamps — already in sync
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

	// ─── Realtime Subscriptions ───────────────────────────────────────

	private static async subscribeRealtime(): Promise<void> {
		if (!pb.authStore.isValid) return;
		let isGuest: boolean;
		try {
			({ isGuest } = getActiveSession());
		} catch {
			return; // session not initialized yet
		}
		if (isGuest || this.subscribed) return;

		for (const table of this.TABLES) {
			await pb.collection(table).subscribe('*', (e) => {
				void this.handleRealtimeEvent(table, e as unknown as RealtimeEvent);
			});
		}
		this.subscribed = true;
	}

	private static async unsubscribeRealtime(): Promise<void> {
		if (!this.subscribed) return;
		for (const table of this.TABLES) {
			try { await pb.collection(table).unsubscribe('*'); } catch { /* ignore */ }
		}
		this.subscribed = false;
	}

	/** On come-back-online / tab-focus: re-subscribe if needed, then catch-up pull. */
	private static async resubscribeAndPull(): Promise<void> {
		if (!this.subscribed) {
			await this.subscribeRealtime();
		}
		await this.syncAll();
	}

	/** Apply a single realtime event pushed by PocketBase. */
	private static async handleRealtimeEvent(tableName: TableName, e: RealtimeEvent): Promise<void> {
		try {
			const remote = this.pbToLocalRecord(e.record);
			const local = await localDB.getRecord<BaseRecord>(tableName, remote.id);
			const remoteAt = remote.updatedAt ?? 0;
			const localAt = local?.updatedAt ?? 0;

			if (!local || remoteAt > localAt) {
				// Remote is strictly newer — accept it
				await localDB.putRecord(tableName, remote);
			} else if (remoteAt < localAt) {
				// Local is newer — push our version back to correct the server
				void this.pushRecord(tableName, local);
			}
			// remoteAt === localAt: already in sync, no action needed
		} catch (err) {
			console.error(`Realtime event error for ${tableName}`, err);
		}
	}

	// ─── Push API (called by service layer) ───────────────────────────

	/**
	 * Push a single record to PocketBase.
	 * - isNew = true  → POST directly (new record, skip the wasted PATCH round-trip)
	 * - isNew = false → PATCH first, create on 404 (existing record or uncertain)
	 * Fire-and-forget: errors are logged but never thrown so local writes always succeed.
	 */
	static async pushRecord(tableName: TableName, record: BaseRecord, isNew = false): Promise<void> {
		if (!pb.authStore.isValid) return;
		try {
			const { isGuest } = getActiveSession();
			if (isGuest) return;
		} catch {
			return; // session not initialized yet
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
				// Record not on server yet — create it
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
	 * Convenience wrapper for after `softDeleteRecord()` calls where the caller
	 * doesn't hold a reference to the updated record object.
	 */
	static async pushById(tableName: TableName, id: string): Promise<void> {
		const record = await localDB.getRecord<BaseRecord>(tableName, id);
		if (record) void this.pushRecord(tableName, record);
	}

	/**
	 * Push all records modified at or after `sinceInclusive` across all sync tables.
	 * Called by the service layer after cascade-delete transactions where multiple
	 * tables are modified atomically and individual record references aren't available.
	 */
	static async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
		if (!pb.authStore.isValid) return;
		try {
			const { isGuest } = getActiveSession();
			if (isGuest) return;
		} catch {
			return;
		}

		for (const table of this.TABLES) {
			// getUnsyncedChanges filters updatedAt > (sinceInclusive - 1) = updatedAt >= sinceInclusive
			const changed = await localDB.getUnsyncedChanges(table, userId, sinceInclusive - 1);
			for (const record of changed) {
				void this.pushRecord(table, record);
			}
		}
	}

	// ─── Serialization ────────────────────────────────────────────────

	/** Uint8Array → Base64 for JSON transport */
	private static localToPbRecord(record: BaseRecord): Record<string, unknown> {
		const payload = { ...record } as Record<string, unknown>;
		for (const key of Object.keys(payload)) {
			if (payload[key] instanceof Uint8Array) {
				payload[key] = toBase64(payload[key] as Uint8Array<ArrayBuffer>);
			}
		}
		return payload;
	}

	/** Base64 → Uint8Array for local storage */
	private static pbToLocalRecord(pbRecord: Record<string, unknown>): BaseRecord {
		const record: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(pbRecord)) {
			if (!this.ALLOWED_RECORD_FIELDS.has(key)) {
				continue;
			}

			record[key] = typeof value === 'string' && this.isBase64ByteField(key) ? fromBase64(value) : value;
		}

		record.createdAt = this.normalizeTimestamp(record.createdAt, pbRecord.created);
		record.updatedAt = this.normalizeTimestamp(record.updatedAt, pbRecord.updated);
		record.isDeleted = Boolean(record.isDeleted);

		return record as unknown as BaseRecord;
	}

	/** Fields that are byte arrays when stored locally */
	private static readonly BYTE_FIELD_NAMES = new Set([
		'encryptedData',
		'encryptedDataIV',
		'masterKey'
	]);

	private static isBase64ByteField(fieldName: string): boolean {
		return this.BYTE_FIELD_NAMES.has(fieldName);
	}

	private static normalizeTimestamp(primary: unknown, fallback: unknown): number {
		if (typeof primary === 'number') {
			return primary;
		}

		if (typeof primary === 'string') {
			const parsed = Number(primary);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}

			const asDate = new Date(primary).getTime();
			if (!Number.isNaN(asDate)) {
				return asDate;
			}
		}

		if (typeof fallback === 'string') {
			const asDate = new Date(fallback).getTime();
			if (!Number.isNaN(asDate)) {
				return asDate;
			}
		}

		return 0;
	}
}
