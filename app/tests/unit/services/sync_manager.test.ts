/**
 * Sync Manager Tests
 *
 * Tests the SyncManager which orchestrates DataSyncService and ProfileSyncService
 * lifecycles (start/stop/reconnect).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '$lib/services/sync';
import { DataSyncService } from '$lib/services/sync/data';
import { ProfileSyncService } from '$lib/services/sync/profile';
import type { Profile } from '$lib/services/user/profile';

// Mock dependencies with stateful spies
vi.mock('$lib/services/sync/data', () => {
	let subscribed = false;
	return {
		DataSyncService: {
			subscribeRealtime: vi.fn(async () => {
				subscribed = true;
			}),
			unsubscribeRealtime: vi.fn(async () => {
				subscribed = false;
			}),
			syncAll: vi.fn(async () => {}),
			get isSubscribed() {
				return subscribed;
			},
			set isSubscribed(v: boolean) {
				subscribed = v;
			}
		}
	} as unknown as {
		DataSyncService: {
			isSubscribed: boolean;
			subscribeRealtime: () => Promise<void>;
			syncAll: () => Promise<void>;
			unsubscribeRealtime: () => Promise<void>;
		};
	};
});

vi.mock('$lib/services/sync/profile', () => ({
	ProfileSyncService: {
		subscribe: vi.fn(async () => {}),
		unsubscribe: vi.fn(async () => {}),
		pullProfile: vi.fn(async () => null)
	}
}));

describe('SyncManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
		vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
		vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
		vi.spyOn(document, 'removeEventListener').mockImplementation(() => {});

		Object.defineProperty(document, 'visibilityState', {
			value: 'visible',
			configurable: true
		});

		// Reset internal static state
		SyncManager.stopAutoSync();
		vi.mocked(DataSyncService.subscribeRealtime).mockClear();
		vi.mocked(ProfileSyncService.subscribe).mockClear();
		(DataSyncService as unknown as { isSubscribed: boolean }).isSubscribed = false;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('startAutoSync', () => {
		it('should start subscriptions and set poll timer', () => {
			const onProfileUpdate = vi.fn();

			SyncManager.startAutoSync({ onProfileUpdate });

			expect(DataSyncService.subscribeRealtime).toHaveBeenCalled();
			expect(ProfileSyncService.subscribe).toHaveBeenCalledWith(onProfileUpdate);

			expect(DataSyncService.syncAll).not.toHaveBeenCalled();
			vi.advanceTimersByTime(300_000);
			expect(DataSyncService.syncAll).toHaveBeenCalledTimes(1);

			expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
			expect(document.addEventListener).toHaveBeenCalledWith(
				'visibilitychange',
				expect.any(Function)
			);
		});

		it('should not start multiple times', () => {
			SyncManager.startAutoSync();
			SyncManager.startAutoSync();
			expect(DataSyncService.subscribeRealtime).toHaveBeenCalledTimes(1);
		});
	});

	describe('stopAutoSync', () => {
		it('should clear subscriptions and poll timer', () => {
			SyncManager.startAutoSync();
			SyncManager.stopAutoSync();

			expect(DataSyncService.unsubscribeRealtime).toHaveBeenCalled();
			expect(ProfileSyncService.unsubscribe).toHaveBeenCalled();

			vi.advanceTimersByTime(300_000);
			expect(DataSyncService.syncAll).not.toHaveBeenCalled();
		});
	});

	describe('event listeners', () => {
		it('should trigger resubscribe on "online" event if offline', async () => {
			const onProfileUpdate = vi.fn();
			SyncManager.startAutoSync({ onProfileUpdate });

			// Find the online listener
			const onlineCall = vi
				.mocked(window.addEventListener)
				.mock.calls.find((c) => c[0] === 'online');
			const onlineHandler = onlineCall?.[1] as () => void;
			expect(onlineHandler).toBeDefined();

			// Force it to look disconnected
			(DataSyncService as unknown as { isSubscribed: boolean }).isSubscribed = false;
			vi.mocked(ProfileSyncService.pullProfile).mockResolvedValue({
				id: 'p1'
			} as unknown as Profile);

			await onlineHandler();
			// We need to wait for the internal async chain
			await Promise.resolve(); // resubscribeAndPull
			await Promise.resolve(); // sub 1
			await Promise.resolve(); // sub 2
			await Promise.resolve(); // syncAll
			await Promise.resolve(); // pullProfile
			await Promise.resolve(); // final callback

			expect(DataSyncService.subscribeRealtime).toHaveBeenCalledTimes(2); // once at start, once at online
			expect(DataSyncService.syncAll).toHaveBeenCalled();
			expect(onProfileUpdate).toHaveBeenCalled();
		});

		it('should only pull on "visibilitychange" if already subscribed', async () => {
			SyncManager.startAutoSync();

			const visCall = vi
				.mocked(document.addEventListener)
				.mock.calls.find((c) => c[0] === 'visibilitychange');
			const visHandler = visCall?.[1] as () => void;

			// Ensure we are marked as subscribed
			(DataSyncService as unknown as { isSubscribed: boolean }).isSubscribed = true;
			vi.mocked(DataSyncService.subscribeRealtime).mockClear();

			await visHandler();
			await Promise.resolve();
			await Promise.resolve();

			expect(DataSyncService.subscribeRealtime).not.toHaveBeenCalled();
			expect(DataSyncService.syncAll).toHaveBeenCalled();
		});
	});
});
