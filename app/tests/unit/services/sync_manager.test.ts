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
import { AssetSyncService } from '$lib/services/sync/asset';
import { appAsset } from '$lib/adapters/asset';
import { appUser } from '$lib/adapters/user';
import { localDB } from '$lib/adapters/db';
import type { DatabaseWriteEventListener } from '$lib/adapters/db';
import type { AssetWriteEventListener } from '$lib/adapters/asset';
import type { UserWriteEventListener } from '$lib/adapters/user';

let dbWriteListener: DatabaseWriteEventListener | null = null;
let assetWriteListener: AssetWriteEventListener | null = null;
let userWriteListener: UserWriteEventListener | null = null;
let storedOnRemoteUpdate: (() => void) | null = null;

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
			handleLocalWrite: vi.fn(async () => {}),
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
			handleLocalWrite: (event: unknown) => Promise<void>;
			subscribeRealtime: () => Promise<void>;
			syncAll: () => Promise<void>;
			unsubscribeRealtime: () => Promise<void>;
		};
	};
});

vi.mock('$lib/adapters/db', () => ({
	SYNC_TABLES: ['characterSummaries', 'chatSummaries'],
	TABLES: ['characterSummaries', 'chatSummaries'],
	localDB: {
		subscribeWriteEvents: vi.fn((listener: DatabaseWriteEventListener) => {
			dbWriteListener = listener;
			return () => {
				dbWriteListener = null;
			};
		})
	}
}));

vi.mock('$lib/adapters/asset', () => ({
	appAsset: {
		subscribeWriteEvents: vi.fn((listener: AssetWriteEventListener) => {
			assetWriteListener = listener;
			return () => {
				assetWriteListener = null;
			};
		})
	}
}));

vi.mock('$lib/adapters/user', () => ({
	appUser: {
		subscribeWriteEvents: vi.fn((listener: UserWriteEventListener) => {
			userWriteListener = listener;
			return () => {
				userWriteListener = null;
			};
		})
	}
}));

vi.mock('$lib/services/sync/profile', () => ({
	ProfileSyncService: {
		setOnRemoteUpdate: vi.fn((cb: (() => void) | null) => {
			storedOnRemoteUpdate = cb;
		}),
		subscribeRealtime: vi.fn(async () => {}),
		unsubscribeRealtime: vi.fn(async () => {}),
		pullProfile: vi.fn(async () => {
			storedOnRemoteUpdate?.();
			return null;
		}),
		pushProfile: vi.fn(async () => {}),
		isSubscribed: false
	}
}));

vi.mock('$lib/services/sync/asset', () => {
	let subscribed = false;
	return {
		AssetSyncService: {
			start: vi.fn(async () => {}),
			stop: vi.fn(),
			subscribeRealtime: vi.fn(async () => {
				subscribed = true;
			}),
			unsubscribeRealtime: vi.fn(async () => {
				subscribed = false;
			}),
			pushById: vi.fn(async () => {}),
			get isSubscribed() {
				return subscribed;
			},
			set isSubscribed(v: boolean) {
				subscribed = v;
			}
		}
	};
});

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
		storedOnRemoteUpdate = null;
		vi.mocked(DataSyncService.subscribeRealtime).mockClear();
		vi.mocked(ProfileSyncService.setOnRemoteUpdate).mockClear();
		vi.mocked(ProfileSyncService.subscribeRealtime).mockClear();
		vi.mocked(ProfileSyncService.unsubscribeRealtime).mockClear();
		vi.mocked(ProfileSyncService.pullProfile).mockClear();
		vi.mocked(AssetSyncService.start).mockClear();
		vi.mocked(AssetSyncService.stop).mockClear();
		vi.mocked(AssetSyncService.subscribeRealtime).mockClear();
		vi.mocked(AssetSyncService.unsubscribeRealtime).mockClear();
		vi.mocked(AssetSyncService.pushById).mockClear();
		(AssetSyncService as unknown as { isSubscribed: boolean }).isSubscribed = false;
		vi.mocked(DataSyncService.handleLocalWrite).mockClear();
		(DataSyncService as unknown as { isSubscribed: boolean }).isSubscribed = false;
		dbWriteListener = null;
		assetWriteListener = null;
		userWriteListener = null;
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
			expect(AssetSyncService.subscribeRealtime).toHaveBeenCalled();
			expect(ProfileSyncService.setOnRemoteUpdate).toHaveBeenCalledWith(onProfileUpdate);
			expect(ProfileSyncService.subscribeRealtime).toHaveBeenCalled();
			expect(AssetSyncService.start).toHaveBeenCalledTimes(1);

			expect(DataSyncService.syncAll).not.toHaveBeenCalled();
			vi.advanceTimersByTime(300_000);
			expect(DataSyncService.syncAll).toHaveBeenCalledTimes(1);
			expect(AssetSyncService.start).toHaveBeenCalledTimes(2);

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
			expect(localDB.subscribeWriteEvents).toHaveBeenCalledTimes(1);
			expect(appAsset.subscribeWriteEvents).toHaveBeenCalledTimes(1);
			expect(appUser.subscribeWriteEvents).toHaveBeenCalledTimes(1);
		});
	});

	describe('stopAutoSync', () => {
		it('should clear subscriptions and poll timer', () => {
			SyncManager.startAutoSync();
			SyncManager.stopAutoSync();

			expect(DataSyncService.unsubscribeRealtime).toHaveBeenCalled();
			expect(AssetSyncService.unsubscribeRealtime).toHaveBeenCalled();
			expect(ProfileSyncService.unsubscribeRealtime).toHaveBeenCalled();
			expect(AssetSyncService.stop).toHaveBeenCalled();

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
			(AssetSyncService as unknown as { isSubscribed: boolean }).isSubscribed = false;

			await onlineHandler();
			// We need to wait for the internal async chain
			await Promise.resolve(); // resubscribeAndPull
			await Promise.resolve(); // sub 1
			await Promise.resolve(); // sub 2
			await Promise.resolve(); // sub 3
			await Promise.resolve(); // syncAll
			await Promise.resolve(); // pullProfile
			await Promise.resolve(); // final callback

			expect(DataSyncService.subscribeRealtime).toHaveBeenCalledTimes(2); // once at start, once at online
			expect(AssetSyncService.subscribeRealtime).toHaveBeenCalledTimes(2); // once at start, once at online
			expect(DataSyncService.syncAll).toHaveBeenCalled();
			expect(AssetSyncService.start).toHaveBeenCalledTimes(2);
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
			expect(AssetSyncService.start).toHaveBeenCalledTimes(2);
		});

		it('should route user write events to ProfileSyncService', async () => {
			SyncManager.startAutoSync();
			expect(userWriteListener).not.toBeNull();

			userWriteListener?.([{ tableName: 'users', ids: ['u1'], origin: 'local', operation: 'put' }]);
			await Promise.resolve();
			expect(ProfileSyncService.pushProfile).toHaveBeenCalled();
		});

		it('should not push profile for sync-origin user writes', async () => {
			SyncManager.startAutoSync();

			userWriteListener?.([{ tableName: 'users', ids: ['u1'], origin: 'sync', operation: 'put' }]);
			await Promise.resolve();
			expect(ProfileSyncService.pushProfile).not.toHaveBeenCalled();
		});

		it('should route local DB writes to the appropriate sync engines', async () => {
			SyncManager.startAutoSync();
			expect(dbWriteListener).not.toBeNull();
			expect(assetWriteListener).not.toBeNull();

			dbWriteListener?.([
				{
					tableName: 'characterSummaries',
					ids: ['c1'],
					origin: 'local',
					operation: 'put'
				}
			]);
			assetWriteListener?.([
				{
					tableName: 'assets',
					ids: ['a1'],
					origin: 'local',
					operation: 'put'
				}
			]);
			assetWriteListener?.([
				{
					tableName: 'assetRegistry',
					ids: ['ar1'],
					origin: 'local',
					operation: 'put'
				}
			]);

			await Promise.resolve();

			expect(DataSyncService.handleLocalWrite).toHaveBeenCalledWith(
				expect.objectContaining({ tableName: 'characterSummaries', ids: ['c1'] })
			);
			// assets writes go to AssetSyncEngine.pushById, not DataSyncService
			expect(AssetSyncService.pushById).toHaveBeenCalledWith('a1');
			expect(DataSyncService.handleLocalWrite).not.toHaveBeenCalledWith(
				expect.objectContaining({ tableName: 'assets' })
			);
			// assetRegistry writes trigger asset upload queue
			expect(AssetSyncService.start).toHaveBeenCalledTimes(2);
		});
	});
});
