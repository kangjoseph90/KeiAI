/**
 * Asset Sync Service — KeiAI v2
 *
 * Background sync engine for uploading local assets to CDN.
 * Follows the same pattern as DataSyncService and ProfileSyncService.
 *
 * Processes assets with status='local' in assetRegistry, uploads to server,
 * and updates status to 'remote' on success.
 */

import { getActiveSession } from '../session';
import { localDB, type AssetRegistryRecord, type AssetRecord } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import type { AssetFields } from '../content/asset/types';
import { AppError } from '$lib/shared/errors';
import { encryptAsset } from '../content/asset/util';
import { BaseSyncEngine, type SyncStatus } from './base';

// ─── Sync State ───────────────────────────────────────────────────────────

export interface AssetSyncStatus extends SyncStatus {
	pendingCount: number;
	currentAssetId?: string;
}

// ─── Asset Sync Service ────────────────────────────────────────────────────

export class AssetSyncEngine extends BaseSyncEngine<AssetSyncStatus> {
	private currentAssetId: string | null = null;
	private abortController: AbortController | null = null;

	constructor() {
		super({ pendingCount: 0 });
	}

	// ── State Management ─────────────────────────────────────────────────

	override getState(): AssetSyncStatus {
		return {
			...super.getState(),
			pendingCount: super.getState().pendingCount,
			currentAssetId: this.currentAssetId ?? undefined
		};
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Start the sync engine.
	 * Processes local assets in the background.
	 */
	async start(): Promise<void> {
		await this.trigger();
	}

	/**
	 * Stop the sync engine.
	 */
	override stop(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.currentAssetId = null;
		this.updateStatus({
			pendingCount: 0,
			currentAssetId: undefined
		});
		super.stop();
	}

	/**
	 * Retry sync after an error.
	 */
	async retry(): Promise<void> {
		await this.trigger();
	}

	// ── Queue Processing ─────────────────────────────────────────────────

	/**
	 * Process all local assets that need to be synced.
	 * Private assets are always synced. Inlay assets are synced only if user enabled sync.
	 */
	protected override async performSync(): Promise<void> {
		this.abortController = new AbortController();

		const { userId, masterKey } = getActiveSession();

		// Get all assets with status='local'
		const allAssets = await localDB.getAll<AssetRegistryRecord>('assetRegistry', userId);

		// Filter: sync private assets, and inlay assets (if user enabled - TODO)
		const toSync = allAssets.filter(
			(a) => a.status === 'local' && (a.kind === 'private' || a.kind === 'inlay')
		);
		this.updateStatus({ pendingCount: toSync.length, progress: undefined });

		for (const [index, entry] of toSync.entries()) {
			if (this.abortController?.signal.aborted) break;

			this.currentAssetId = entry.id;
			this.updateStatus({
				currentAssetId: entry.id,
				progress: {
					completed: index,
					total: toSync.length,
					currentItemId: entry.id
				}
			});

			try {
				await this.syncAsset(entry.id, masterKey, userId);
				this.updateStatus({
					pendingCount: Math.max(toSync.length - (index + 1), 0),
					progress: {
						completed: index + 1,
						total: toSync.length,
						currentItemId: entry.id
					}
				});
			} catch (error) {
				if (this.isQuotaError(error)) {
					throw error; // Stop processing on quota error
				} else if (this.isAuthError(error)) {
					throw error; // Stop processing on auth error
				}
				// Network errors: log and continue
				console.error(`Failed to sync asset ${entry.id}:`, error);
			}
		}

		this.currentAssetId = null;
		this.updateStatus({
			currentAssetId: undefined,
			pendingCount: 0,
			progress: undefined
		});
	}

	/**
	 * Sync a single asset to the server.
	 */
	private async syncAsset(id: string, masterKey: CryptoKey, userId: string): Promise<void> {
		// Get the asset record
		const record = await localDB.getRecord<AssetRecord>('assets', id);
		if (!record || record.isDeleted) {
			// Asset was deleted, skip
			await localDB.deleteRecord('assetRegistry', id, { origin: 'sync' });
			return;
		}

		// Decrypt fields to get hash
		const fields = await this.decryptAssetFields(masterKey, record);

		// Read local binary
		const bytes = await appStorage.read(id);
		if (!bytes) {
			throw new AppError('ASSET_ERROR', 'Asset file not found locally', undefined);
		}

		// Encrypt for private assets (public assets uploaded as plaintext)
		let uploadBytes: Uint8Array;
		if (fields.kind === 'private') {
			uploadBytes = await encryptAsset(bytes, fields.encKey);
		} else {
			uploadBytes = bytes;
		}

		// TODO: Upload to server
		// const response = await fetch('/api/assets/upload', {
		//   method: 'POST',
		//   body: formData,
		//   signal: this.abortController?.signal
		// });

		// For now, simulate successful upload
		await this.markAsRemote(id, userId);
	}

	/**
	 * Mark an asset as remote after successful upload.
	 */
	private async markAsRemote(id: string, userId: string): Promise<void> {
		const entry = await localDB.getRecord<AssetRegistryRecord>('assetRegistry', id);
		if (!entry) return;

		entry.status = 'remote';
		entry.updatedAt = Date.now();
		await localDB.putRecord('assetRegistry', entry, { origin: 'sync' });
	}

	// ── Promotion ─────────────────────────────────────────────────────────

	/**
	 * Promote a private asset to public.
	 * Waits for current sync to complete, then uploads decrypted version.
	 */
	async promoteToPublic(id: string): Promise<string> {
		// Wait for current sync to finish
		if (this.getState().state === 'syncing') {
			this.stop();
		}

		// TODO: Implement promotion flow
		// 1. Decrypt asset
		// 2. Upload to CDN as plaintext
		// 3. Update asset kind to 'public'
		// 4. Release quota

		return ''; // Return CDN URL
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	private async decryptAssetFields(
		masterKey: CryptoKey,
		record: AssetRecord
	): Promise<AssetFields> {
		const { decrypt } = await import('$lib/crypto');
		return decrypt(masterKey, {
			ciphertext: record.encryptedData,
			iv: record.encryptedDataIV
		})
			.then((raw: string) => JSON.parse(raw) as AssetFields)
			.catch((error: unknown) => {
				throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt asset record', error);
			});
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

// ─── Export Singleton ─────────────────────────────────────────────────────

export const AssetSyncService = new AssetSyncEngine();
