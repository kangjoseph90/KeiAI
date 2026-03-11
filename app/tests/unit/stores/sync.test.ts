import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { startSyncStatusTracking, stopSyncStatusTracking } from '$lib/stores/sync';
import { dataSyncStatus, profileSyncStatus, assetSyncStatus } from '$lib/stores/state';

const dataStatusListeners = new Set<(status: { state: string }) => void>();
const profileStatusListeners = new Set<(status: { state: string }) => void>();
const assetStatusListeners = new Set<
	(status: { state: string; pendingCount: number; currentAssetId?: string }) => void
>();

vi.mock('$lib/services/sync', () => ({
	DataSyncService: {
		subscribeStatus: vi.fn((listener: (status: { state: string }) => void) => {
			dataStatusListeners.add(listener);
			listener({ state: 'idle' });
			return () => dataStatusListeners.delete(listener);
		})
	},
	ProfileSyncService: {
		subscribeStatus: vi.fn((listener: (status: { state: string }) => void) => {
			profileStatusListeners.add(listener);
			listener({ state: 'idle' });
			return () => profileStatusListeners.delete(listener);
		})
	},
	AssetSyncService: {
		subscribeStatus: vi.fn(
			(listener: (status: { state: string; pendingCount: number }) => void) => {
				assetStatusListeners.add(listener);
				listener({ state: 'idle', pendingCount: 0 });
				return () => assetStatusListeners.delete(listener);
			}
		)
	}
}));

describe('sync status stores', () => {
	beforeEach(() => {
		stopSyncStatusTracking();
		dataStatusListeners.clear();
		profileStatusListeners.clear();
		assetStatusListeners.clear();
		dataSyncStatus.set({ state: 'idle' });
		profileSyncStatus.set({ state: 'idle' });
		assetSyncStatus.set({ state: 'idle', pendingCount: 0 });
	});

	it('should mirror sync engine statuses into store state', () => {
		startSyncStatusTracking();

		for (const listener of dataStatusListeners) {
			listener({ state: 'syncing' });
		}
		for (const listener of profileStatusListeners) {
			listener({ state: 'network_error' });
		}
		for (const listener of assetStatusListeners) {
			listener({ state: 'syncing', pendingCount: 3, currentAssetId: 'asset-1' });
		}

		expect(get(dataSyncStatus)).toEqual({ state: 'syncing' });
		expect(get(profileSyncStatus)).toEqual({ state: 'network_error' });
		expect(get(assetSyncStatus)).toEqual({
			state: 'syncing',
			pendingCount: 3,
			currentAssetId: 'asset-1'
		});
	});

	it('should reset stores when tracking stops', () => {
		startSyncStatusTracking();

		for (const listener of assetStatusListeners) {
			listener({ state: 'quota_error', pendingCount: 2, currentAssetId: 'asset-2' });
		}

		stopSyncStatusTracking();

		expect(get(dataSyncStatus)).toEqual({ state: 'idle' });
		expect(get(profileSyncStatus)).toEqual({ state: 'idle' });
		expect(get(assetSyncStatus)).toEqual({ state: 'idle', pendingCount: 0 });
	});
});
