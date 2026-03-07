/**
 * Sync Module - Barrel Export & Lifecycle Orchestrator
 *
 * Directory layout:
 *   sync/data.ts     - DataSyncService:    encrypted app data (characters, chats, etc.)
 *   sync/profile.ts  - ProfileSyncService: plaintext user profile (name, avatar)
 *   sync/index.ts    - SyncManager:        unified lifecycle (start/stop/reconnect)
 *
 * Future additions (e.g. AssetSyncService) plug in here.
 *
 * This module has NO dependency on Svelte stores. Store refresh callbacks are
 * injected via startAutoSync() options, keeping the dependency direction as:
 *   stores → sync (never sync → stores)
 */

export { DataSyncService } from './data.js';
export { ProfileSyncService } from './profile.js';

import { DataSyncService } from './data.js';
import { ProfileSyncService } from './profile.js';

/**
 * Unified lifecycle controller for all sync services.
 * UI code (e.g. +page.svelte) only needs to call SyncManager methods.
 */
export class SyncManager {
	private static pollTimer: ReturnType<typeof setInterval> | null = null;
	private static onlineListener: (() => void) | null = null;
	private static visibilityListener: (() => void) | null = null;
	private static onProfileUpdate: (() => void) | null = null;

	private static readonly FALLBACK_POLL_INTERVAL_MS = 300_000;

	// ─── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start all sync subscriptions and the fallback poll timer.
	 *
	 * @param options.onProfileUpdate - Callback invoked when a remote profile
	 *        update is applied locally. Injected here so the sync layer never
	 *        imports from the store layer directly.
	 */
	static startAutoSync(options?: { onProfileUpdate?: () => void }): void {
		if (typeof window === 'undefined' || this.pollTimer) return;

		this.onProfileUpdate = options?.onProfileUpdate ?? null;

		// Data sync Realtime subscriptions
		void DataSyncService.subscribeRealtime();

		// Profile sync Realtime subscription (callback wired here)
		void ProfileSyncService.subscribe(this.onProfileUpdate ?? undefined);

		// Fallback poll: catches offline gaps that subscriptions miss
		this.pollTimer = setInterval(() => void DataSyncService.syncAll(), this.FALLBACK_POLL_INTERVAL_MS);

		this.onlineListener = () => void this.resubscribeAndPull();
		window.addEventListener('online', this.onlineListener);

		this.visibilityListener = () => {
			if (document.visibilityState === 'visible') void this.resubscribeAndPull();
		};
		document.addEventListener('visibilitychange', this.visibilityListener);
	}

	static stopAutoSync(): void {
		void DataSyncService.unsubscribeRealtime();
		void ProfileSyncService.unsubscribe();
		if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
		if (typeof window !== 'undefined') {
			if (this.onlineListener) { window.removeEventListener('online', this.onlineListener); this.onlineListener = null; }
			if (this.visibilityListener) { document.removeEventListener('visibilitychange', this.visibilityListener); this.visibilityListener = null; }
		}
		this.onProfileUpdate = null;
	}

	/**
	 * Full data sync. Called on boot and after login.
	 */
	static async syncAll(): Promise<void> {
		await DataSyncService.syncAll();
	}

	// ─── Internal ────────────────────────────────────────────────────

	/** On come-back-online / tab-focus: re-subscribe if needed, then catch-up pull. */
	private static async resubscribeAndPull(): Promise<void> {
		if (!DataSyncService.isSubscribed) {
			await DataSyncService.subscribeRealtime();
			await ProfileSyncService.subscribe(this.onProfileUpdate ?? undefined);
		}
		await DataSyncService.syncAll();

		// Pull latest profile changes that may have been missed while offline
		const updatedProfile = await ProfileSyncService.pullProfile();
		if (updatedProfile && this.onProfileUpdate) {
			this.onProfileUpdate();
		}
	}
}
