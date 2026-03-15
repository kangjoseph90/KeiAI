/**
 * Asset Sync Engine — KeiAI v2
 *
 * Full bidirectional sync for the `assets` table + CDN upload/delete queues.
 *
 * performSync order:
 *   1. Pull: Paged catch-up + PB Realtime subscription (table sync)
 *   2. Delete queue: Process registry entries with isDeleted=true
 *   3. Upload queue: Process registry entries with status='local'
 *
 * This module has NO dependency on Svelte stores.
 */

import { pb } from '$lib/adapters/pb';
import { decrypt, toBase64, fromBase64, type Bytes, encrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { appAsset, type AssetRecord, type AssetFields } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { AppError } from '$lib/types/errors';
import { encryptAsset } from '../asset/util';
import { BaseSyncEngine, type SyncStatus } from './base';
import { uploadAsset, deleteRemoteAsset, promoteAsset } from '../asset/remote';

// ─── Types ────────────────────────────────────────────────────────────

type RealtimeEvent = {
	action: string;
	record: Record<string, unknown>;
};

export interface AssetSyncStatus extends SyncStatus {
	pendingCount: number;
	currentAssetId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const PAGE_SIZE = 200;
const SYNC_KEY_PREFIX = 'lastSync_assets_';

const ALLOWED_RECORD_FIELDS = new Set([
	'id',
	'userId',
	'createdAt',
	'updatedAt',
	'isDeleted',
	'encryptedData',
	'encryptedDataIV'
]);

const BYTE_FIELD_NAMES = new Set(['encryptedData', 'encryptedDataIV']);

// ─── Helpers ──────────────────────────────────────────────────────────

async function decryptAssetFields(masterKey: CryptoKey, record: AssetRecord): Promise<AssetFields> {
	try {
		const raw = await decrypt(masterKey, {
			ciphertext: record.encryptedData as unknown as Bytes,
			iv: record.encryptedDataIV as unknown as Bytes
		});
		return JSON.parse(raw) as AssetFields;
	} catch (error) {
		throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt asset record', error);
	}
}

// ─── Asset Sync Engine ────────────────────────────────────────────────

export class AssetSyncEngine extends BaseSyncEngine<AssetSyncStatus> {
	private subscribed = false;
	private currentAssetId: string | null = null;
	private abortController: AbortController | null = null;

	constructor() {
		super({ pendingCount: 0 });
	}

	// ── State ─────────────────────────────────────────────────────────

	get isSubscribed(): boolean {
		return this.subscribed;
	}

	override getState(): AssetSyncStatus {
		return {
			...super.getState(),
			pendingCount: super.getState().pendingCount,
			currentAssetId: this.currentAssetId ?? undefined
		};
	}

	// ── Lifecycle ─────────────────────────────────────────────────────

	async start(): Promise<void> {
		await this.trigger();
	}

	override stop(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.currentAssetId = null;
		this.updateStatus({ pendingCount: 0, currentAssetId: undefined });
		super.stop();
	}

	async retry(): Promise<void> {
		await this.trigger();
	}

	// ── Realtime Subscriptions ────────────────────────────────────────

	async subscribeRealtime(): Promise<void> {
		if (!pb.authStore.isValid || this.subscribed) return;

		let isGuest: boolean;
		try {
			({ isGuest } = getActiveSession());
		} catch {
			return;
		}
		if (isGuest) return;

		await pb.collection('assets').subscribe('*', (e) => {
			void this.handleRealtimeEvent(e as unknown as RealtimeEvent);
		});
		this.subscribed = true;
	}

	async unsubscribeRealtime(): Promise<void> {
		if (!this.subscribed) return;
		try {
			await pb.collection('assets').unsubscribe('*');
		} catch {
			/* ignore */
		}
		this.subscribed = false;
	}

	// ── Cursor Management ─────────────────────────────────────────────

	async resetCursors(userId: string): Promise<void> {
		await appKV.remove(`${SYNC_KEY_PREFIX}${userId}`);
	}

	// ── Core Sync Cycle ───────────────────────────────────────────────

	/**
	 * Full sync cycle:
	 *   1. Pull catch-up from PocketBase (paged table sync)
	 *   2. Process delete queue (registry isDeleted=true → CDN delete → hard delete)
	 *   3. Process upload queue (registry status=local → upload/promote)
	 */
	protected override async performSync(): Promise<void> {
		if (!pb.authStore.isValid) return;

		this.abortController = new AbortController();

		let userId: string;
		let masterKey: CryptoKey;
		let isGuest: boolean;
		try {
			({ userId, masterKey, isGuest } = getActiveSession());
		} catch {
			return;
		}
		if (isGuest) return;

		// Phase 1: Pull catch-up from PocketBase
		await this.pullAssets(userId);

		if (this.abortController.signal.aborted) return;

		// Phase 2: Process delete queue (before uploads — hash reuse safety)
		await this.processDeleteQueue(userId);

		if (this.abortController.signal.aborted) return;

		// Phase 3: Process upload queue
		await this.processUploadQueue(userId, masterKey);

		this.currentAssetId = null;
		this.updateStatus({ currentAssetId: undefined, pendingCount: 0, progress: undefined });
	}

	// ── Pull (Server → Local) ─────────────────────────────────────────

	private async pullAssets(userId: string): Promise<void> {
		const syncKey = `${SYNC_KEY_PREFIX}${userId}`;
		const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
		let nextCursor = lastSyncTime;
		let cursorSafeToAdvance = true;
		let page = 1;
		let syncError: unknown = null;
		const offlineWrites: AssetRecord[] = [];

		try {
			while (true) {
				if (this.abortController?.signal.aborted) break;

				const result = await pb.collection('assets').getList(page, PAGE_SIZE, {
					filter: pb.filter('userId = {:userId} && updatedAt >= {:since}', {
						userId,
						since: lastSyncTime
					}),
					sort: 'updatedAt'
				});

				for (const serverRecord of result.items) {
					const remote = this.pbToLocalRecord(serverRecord as unknown as Record<string, unknown>);
					const local = await appAsset.getAsset(remote.id);
					const remoteAt = remote.updatedAt ?? 0;
					const localAt = local?.updatedAt ?? 0;

					if (!local || remoteAt > localAt) {
						// Server is newer → apply
						if (remote.isDeleted) {
							// Deleted on another device → local cleanup
							await appAsset.putAsset(remote, { origin: 'sync' });
							await appStorage.delete(`assets/${remote.id}`).catch(() => undefined);
							await appAsset.deleteRegistry(remote.id, { origin: 'sync' });
						} else {
							await appAsset.putAsset(remote, { origin: 'sync' });
						}
						nextCursor = Math.max(nextCursor, remoteAt);
					} else if (localAt > remoteAt) {
						// Local is newer → push correction
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
			console.error('[AssetSync] Failed to pull assets', err);
		}

		if (cursorSafeToAdvance && nextCursor > lastSyncTime) {
			await appKV.set(syncKey, nextCursor.toString());
		}

		// Push locally-newer records
		if (offlineWrites.length > 0) {
			void this.pushBatch(offlineWrites);
		}

		if (syncError) throw syncError;
	}

	// ── Realtime Event Handler ────────────────────────────────────────

	private async handleRealtimeEvent(e: RealtimeEvent): Promise<void> {
		try {
			let userId: string;
			try {
				({ userId } = getActiveSession());
			} catch {
				return;
			}

			const remote = this.pbToLocalRecord(e.record);
			const local = await appAsset.getAsset(remote.id);
			const remoteAt = remote.updatedAt ?? 0;
			const localAt = local?.updatedAt ?? 0;

			if (!local || remoteAt > localAt) {
				if (remote.isDeleted) {
					await appAsset.putAsset(remote, { origin: 'sync' });
					await appStorage.delete(`assets/${remote.id}`).catch(() => undefined);
					await appAsset.deleteRegistry(remote.id, { origin: 'sync' });
				} else {
					await appAsset.putAsset(remote, { origin: 'sync' });
				}
			} else if (localAt > remoteAt) {
				void this.pushRecord(local);
			}
		} catch (err) {
			console.error('[AssetSync] Realtime event error', err);
		}
	}

	// ── Push (Local → Server) ─────────────────────────────────────────

	async pushRecord(record: AssetRecord, isNew = false): Promise<void> {
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
			batch.collection('assets').create(payload);
		} else {
			batch.collection('assets').upsert(payload);
		}

		try {
			await batch.send();
		} catch (err) {
			console.error(`[AssetSync] Failed to push ${record.id}`, err);
		}
	}

	private async pushBatch(records: AssetRecord[]): Promise<void> {
		const batch = pb.createBatch();
		for (const record of records) {
			batch.collection('assets').upsert(this.localToPbRecord(record));
		}
		try {
			await batch.send();
		} catch (err) {
			console.error('[AssetSync] Failed to push batch', err);
		}
	}

	async pushById(id: string): Promise<void> {
		const record = await appAsset.getAsset(id);
		if (record) void this.pushRecord(record);
	}

	async pushRecentWrites(userId: string, sinceInclusive: number): Promise<void> {
		if (!pb.authStore.isValid) return;
		try {
			const { isGuest } = getActiveSession();
			if (isGuest) return;
		} catch {
			return;
		}

		const changed = await appAsset.getAssetsSince(userId, sinceInclusive - 1);
		if (changed.length === 0) return;

		void this.pushBatch(changed);
	}

	// ── Delete Queue Processing ───────────────────────────────────────

	/**
	 * Process registry entries with isDeleted=true.
	 * For remote entries → call server delete (refCount decrement).
	 * For local entries → skip server call (never uploaded).
	 * Always hard-delete the registry entry after processing.
	 */
	private async processDeleteQueue(userId: string): Promise<void> {
		const pending = await appAsset.getDeletedRegistry(userId);

		for (const entry of pending) {
			if (this.abortController?.signal.aborted) break;

			try {
				if (entry.status === 'remote') {
					// Server has this asset → delete (refCount decrement)
					// noOp if not owner or missing — not an error
					await deleteRemoteAsset(entry.hash);
				}
				// Local-only assets never reached the server → skip

				// Hard-delete from registry (consume queue entry)
				await appAsset.deleteRegistry(entry.id);
			} catch (error) {
				if (this.isAuthError(error)) throw error;
				console.error(`[AssetSync] Failed to process delete for ${entry.id}:`, error);
			}
		}
	}

	// ── Upload Queue Processing ───────────────────────────────────────

	/**
	 * Process all registry entries with status='local' and isDeleted=false.
	 * Uploads/promotes based on kind:
	 *   - public → promote (plaintext file replaces encrypted)
	 *   - private/inlay → encrypt then upload
	 */
	private async processUploadQueue(userId: string, masterKey: CryptoKey): Promise<void> {
		const allRegistry = await appAsset.getAllRegistry(userId);
		const pending = allRegistry.filter((r) => r.status === 'local');
		this.updateStatus({ pendingCount: pending.length, progress: undefined });

		for (const [index, entry] of pending.entries()) {
			if (this.abortController?.signal.aborted) break;

			this.currentAssetId = entry.id;
			this.updateStatus({
				currentAssetId: entry.id,
				progress: {
					completed: index,
					total: pending.length,
					currentItemId: entry.id
				}
			});

			try {
				const blob = await appStorage.read(`assets/${entry.id}`);
				if (!blob) continue; // Invariant violation, skip

				if (entry.kind === 'public') {
					// Promote: plaintext file replaces encrypted version
					await promoteAsset(entry.hash, blob);
				} else {
					// private/inlay: encrypt then upload
					const encrypted = await encryptAsset(blob, entry.encKey);
					await uploadAsset(entry.hash, entry.kind, encrypted.length, encrypted);
				}

				// Any non-error response → mark as remote
				await appAsset.putRegistry({ ...entry, status: 'remote', updatedAt: Date.now() });

				// Also update asset table status
				const assetRecord = await appAsset.getAsset(entry.id);
				if (assetRecord) {
					try {
						const fields = await decryptAssetFields(masterKey, assetRecord);
						if (fields.status !== 'remote') {
							// Re-encrypt with updated status
							const updatedFields: AssetFields = { ...fields, status: 'remote' };
							const { ciphertext, iv } = await encrypt(masterKey, JSON.stringify(updatedFields));
							await appAsset.putAsset({
								...assetRecord,
								encryptedData: ciphertext,
								encryptedDataIV: iv,
								updatedAt: Date.now()
							});
						}
					} catch {
						// Non-critical: registry is already updated
					}
				}

				this.updateStatus({
					pendingCount: Math.max(pending.length - (index + 1), 0),
					progress: {
						completed: index + 1,
						total: pending.length,
						currentItemId: entry.id
					}
				});
			} catch (error) {
				if (this.isQuotaError(error)) throw error;
				if (this.isAuthError(error)) throw error;
				console.error(`[AssetSync] Failed to sync asset ${entry.id}:`, error);
			}
		}
	}

	// ── Serialization Helpers ─────────────────────────────────────────

	private localToPbRecord(record: AssetRecord): Record<string, unknown> {
		const payload = { ...record } as Record<string, unknown>;
		for (const key of Object.keys(payload)) {
			if (payload[key] instanceof Uint8Array) {
				payload[key] = toBase64(payload[key] as Bytes);
			}
		}
		return payload;
	}

	private pbToLocalRecord(pbRecord: Record<string, unknown>): AssetRecord {
		const record: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(pbRecord)) {
			if (!ALLOWED_RECORD_FIELDS.has(key)) continue;
			record[key] =
				typeof value === 'string' && BYTE_FIELD_NAMES.has(key) ? fromBase64(value) : value;
		}

		record.createdAt = this.normalizeTimestamp(record.createdAt, pbRecord.created);
		record.updatedAt = this.normalizeTimestamp(record.updatedAt, pbRecord.updated);
		record.isDeleted = Boolean(record.isDeleted);

		return record as unknown as AssetRecord;
	}

	protected override isQuotaError(error: unknown): boolean {
		if (error instanceof AppError) {
			return error.code === 'QUOTA_EXCEEDED';
		}
		if (error instanceof Response) {
			return error.status === 402 || error.status === 413;
		}
		return false;
	}

	protected override isAuthError(error: unknown): boolean {
		if (error instanceof AppError) {
			return error.code === 'NOT_AUTHENTICATED' || error.code === 'SESSION_EXPIRED';
		}
		if (error instanceof Response) {
			return error.status === 401 || error.status === 403;
		}
		return false;
	}
}

// ─── Export Singleton ─────────────────────────────────────────────────

export const AssetSyncService = new AssetSyncEngine();
