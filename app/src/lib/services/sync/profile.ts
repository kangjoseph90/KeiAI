/**
 * Profile Sync Service
 *
 * Handles bidirectional synchronization of user profile data (name, avatar)
 * with PocketBase. Separated from DataSyncService because profile data:
 *   - Lives in the `users` PB collection (not the encrypted data tables)
 *   - Is NOT E2EE (name/avatar are plaintext)
 *   - Has different serialization (avatar is a PB file field, not Base64 blob)
 *
 * Push: Called by ProfileService.update() after local writes.
 * Pull: PB Realtime subscription on the user's own record.
 *
 * This module has NO dependency on Svelte stores - store refresh is handled
 * via a callback injected by SyncManager at subscribe() time.
 */

import { pb } from '../../adapters/pb.js';
import { getActiveSession } from '../session.js';
import { ProfileService, type Profile } from '../auth/profile.js';
import { appUser } from '../../adapters/user/index.js';

export class ProfileSyncService {
	private static subscribed = false;
	private static onRemoteUpdate: (() => void) | null = null;

	// ─── Push (local → server) ──────────────────────────────────────

	/**
	 * Push the current profile to PocketBase.
	 * Fire-and-forget: errors are logged but never thrown.
	 */
	static async pushProfile(name: string, avatarDataUri?: string): Promise<void> {
		if (!pb.authStore.isValid) return;

		try {
			const { isGuest, userId } = getActiveSession();
			if (isGuest) return;

			const updateData: Record<string, unknown> = { name };

			// Track whether we're actually uploading a new blob this call.
			// This flag breaks the otherwise-infinite loop:
			//   ProfileService.update() → pushProfile() → ProfileService.update() → …
			let uploadedNewBlob = false;
			if (avatarDataUri?.startsWith('data:image')) {
				try {
					const fetchResponse = await fetch(avatarDataUri);
					updateData.avatar = await fetchResponse.blob();
					uploadedNewBlob = true;
				} catch (e) {
					console.warn('[ProfileSync] Failed to parse avatar data URI for upload', e);
				}
			}

			const record = await pb.collection('users').update(userId, updateData);

			// Only swap the local data URI for the lighter PB file URL when we
			// actually uploaded a new file this call. Write directly to appUser
			// (not via ProfileService.update) to avoid re-triggering pushProfile.
			if (uploadedNewBlob && record?.avatar) {
				const serverAvatarUrl = pb.files.getURL(record, record.avatar);
				const user = await appUser.getUser(userId);
				if (user) {
					user.avatar = serverAvatarUrl;
					user.updatedAt = Date.now();
					await appUser.saveUser(user);
				}
			}
		} catch (err) {
			console.error('[ProfileSync] Push failed', err);
		}
	}

	// ─── Pull (server → local via Realtime) ──────────────────────────

	/**
	 * Subscribe to Realtime updates on the current user's PB record.
	 *
	 * @param onRemoteUpdate - Callback invoked when a remote update is applied
	 *                         locally. Typically `loadProfile` from the store layer.
	 *                         Injected here so the sync layer stays store-agnostic.
	 */
	static async subscribe(onRemoteUpdate?: () => void): Promise<void> {
		if (!pb.authStore.isValid || this.subscribed) return;

		this.onRemoteUpdate = onRemoteUpdate ?? null;

		let userId: string;
		let isGuest: boolean;
		try {
			({ userId, isGuest } = getActiveSession());
		} catch {
			return;
		}
		if (isGuest) return;

		await pb.collection('users').subscribe(userId, (e) => {
			void this.handleRealtimeEvent(e.record as Record<string, unknown>);
		});
		this.subscribed = true;
	}

	/**
	 * Unsubscribe from Realtime profile updates.
	 */
	static async unsubscribe(): Promise<void> {
		if (!this.subscribed) return;

		try {
			const { userId } = getActiveSession();
			await pb.collection('users').unsubscribe(userId);
		} catch {
			// session may not exist anymore; that's fine
		}
		this.subscribed = false;
		this.onRemoteUpdate = null;
	}

	/**
	 * Handle a Realtime event for the user's own PB record.
	 */
	private static async handleRealtimeEvent(
		serverRecord: Record<string, unknown>
	): Promise<Profile | null> {
		try {
			const { userId } = getActiveSession();

			const remoteName = (serverRecord.name as string) ?? '';
			let remoteAvatar = '';
			if (serverRecord.avatar) {
				remoteAvatar = pb.files.getURL(
					serverRecord as { id: string; collectionId: string; collectionName: string },
					serverRecord.avatar as string
				);
			}

			const remoteUpdatedAt = serverRecord.updated
				? new Date(serverRecord.updated as string).getTime()
				: 0;

			const updated = await ProfileService.applyRemoteUpdate(
				userId,
				remoteName,
				remoteAvatar,
				remoteUpdatedAt
			);

			// Notify the store layer via the injected callback
			if (updated && this.onRemoteUpdate) {
				this.onRemoteUpdate();
			}

			return updated;
		} catch (err) {
			console.error('[ProfileSync] Realtime event error', err);
			return null;
		}
	}

	/**
	 * One-shot pull: fetch the latest profile from PB and apply if newer.
	 * Called on reconnect / tab focus.
	 */
	static async pullProfile(): Promise<Profile | null> {
		if (!pb.authStore.isValid) return null;

		try {
			const { userId, isGuest } = getActiveSession();
			if (isGuest) return null;

			const serverRecord = await pb.collection('users').getOne(userId);
			const remoteName = (serverRecord.name as string) ?? '';
			let remoteAvatar = '';
			if (serverRecord.avatar) {
				remoteAvatar = pb.files.getURL(serverRecord, serverRecord.avatar as string);
			}

			const remoteUpdatedAt = serverRecord.updated
				? new Date(serverRecord.updated as string).getTime()
				: 0;

			return await ProfileService.applyRemoteUpdate(
				userId,
				remoteName,
				remoteAvatar,
				remoteUpdatedAt
			);
		} catch (err) {
			console.error('[ProfileSync] Pull failed', err);
			return null;
		}
	}
}
