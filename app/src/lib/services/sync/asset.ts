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

// ─── Sync State ───────────────────────────────────────────────────────────

export type AssetSyncState = 'idle' | 'syncing' | 'network_error' | 'quota_error' | 'auth_error';

export interface AssetSyncStatus {
	state: AssetSyncState;
	pendingCount: number;
	currentAssetId?: string;
}

// ─── Asset Sync Service ────────────────────────────────────────────────────

class AssetSyncServiceClass {
	private state: AssetSyncState = 'idle';
	private currentAssetId: string | null = null;
	private abortController: AbortController | null = null;

	// ── State Management ─────────────────────────────────────────────────

	getState(): AssetSyncStatus {
		return {
			state: this.state,
			pendingCount: this.getPendingCount(),
			currentAssetId: this.currentAssetId ?? undefined
		};
	}

	private getPendingCount(): number {
		// This is cached/estimated - actual count requires DB query
		return 0; // TODO: Implement proper counting
	}

	private setState(newState: AssetSyncState): void {
		this.state = newState;
		// TODO: Notify store/UI subscribers
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Start the sync engine.
	 * Processes local assets in the background.
	 */
	async start(): Promise<void> {
		if (this.state === 'syncing') return;

		this.setState('syncing');
		this.abortController = new AbortController();

		try {
			await this.processQueue();
			this.setState('idle');
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				this.setState('idle');
			} else {
				console.error('Asset sync error:', error);
				this.setState('network_error');
			}
		}
	}

	/**
	 * Stop the sync engine.
	 */
	stop(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.currentAssetId = null;
		this.setState('idle');
	}

	/**
	 * Retry sync after an error.
	 */
	async retry(): Promise<void> {
		if (this.state === 'syncing') return;

		this.abortController = new AbortController();
		await this.start();
	}

	// ── Queue Processing ─────────────────────────────────────────────────

	/**
	 * Process all local assets that need to be synced.
	 * Private assets are always synced. Inlay assets are synced only if user enabled sync.
	 */
	private async processQueue(): Promise<void> {
		const { userId, masterKey } = getActiveSession();

		// Get all assets with status='local'
		const allAssets = await localDB.getAll<AssetRegistryRecord>('assetRegistry', userId);

		// Filter: sync private assets, and inlay assets (if user enabled - TODO)
		const toSync = allAssets.filter(
			(a) => a.status === 'local' && (a.kind === 'private' || a.kind === 'inlay')
		);

		for (const entry of toSync) {
			if (this.abortController?.signal.aborted) break;

			this.currentAssetId = entry.id;

			try {
				await this.syncAsset(entry.id, masterKey, userId);
			} catch (error) {
				if (this.isQuotaError(error)) {
					this.setState('quota_error');
					throw error; // Stop processing on quota error
				} else if (this.isAuthError(error)) {
					this.setState('auth_error');
					throw error; // Stop processing on auth error
				}
				// Network errors: log and continue
				console.error(`Failed to sync asset ${entry.id}:`, error);
			}
		}

		this.currentAssetId = null;
	}

	/**
	 * Sync a single asset to the server.
	 */
	private async syncAsset(id: string, masterKey: CryptoKey, userId: string): Promise<void> {
		// Get the asset record
		const record = await localDB.getRecord<AssetRecord>('assets', id);
		if (!record || record.isDeleted) {
			// Asset was deleted, skip
			await localDB.deleteRecord('assetRegistry', id);
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
		await localDB.putRecord('assetRegistry', entry);
	}

	// ── Promotion ─────────────────────────────────────────────────────────

	/**
	 * Promote a private asset to public.
	 * Waits for current sync to complete, then uploads decrypted version.
	 */
	async promoteToPublic(id: string): Promise<string> {
		// Wait for current sync to finish
		if (this.state === 'syncing') {
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

	private isQuotaError(error: unknown): boolean {
		if (error instanceof AppError) {
			return error.code === 'QUOTA_EXCEEDED';
		}
		if (error instanceof Response) {
			return error.status === 402 || error.status === 413;
		}
		return false;
	}

	private isAuthError(error: unknown): boolean {
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

export const AssetSyncService = new AssetSyncServiceClass();
