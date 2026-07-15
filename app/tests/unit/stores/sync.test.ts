import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { startSyncStatusTracking, stopSyncStatusTracking } from '$lib/stores/sync';
import {
    dataSyncStatus,
    userSyncStatus,
    multiSyncStatus,
    assetSyncStatus
} from '$lib/stores/state';

const dataStatusListeners = new Set<(status: { state: string }) => void>();
const userStatusListeners = new Set<(status: { state: string }) => void>();
const multiStatusListeners = new Set<(status: { state: string }) => void>();
const assetStatusListeners = new Set<
    (status: { state: string; progress?: SyncProgress }) => void
>();

interface SyncProgress {
    completed: number;
    total: number;
}

vi.mock('$lib/services/sync', () => ({
    DataRecordSyncEngine: {
        subscribeStatus: vi.fn((listener: (status: { state: string }) => void) => {
            dataStatusListeners.add(listener);
            listener({ state: 'idle' });
            return () => dataStatusListeners.delete(listener);
        })
    },
    UserRecordSyncEngine: {
        subscribeStatus: vi.fn((listener: (status: { state: string }) => void) => {
            userStatusListeners.add(listener);
            listener({ state: 'idle' });
            return () => userStatusListeners.delete(listener);
        })
    },
    MultiRecordSyncEngine: {
        subscribeStatus: vi.fn((listener: (status: { state: string }) => void) => {
            multiStatusListeners.add(listener);
            listener({ state: 'idle' });
            return () => multiStatusListeners.delete(listener);
        })
    },
    AssetSyncEngine: {
        subscribeStatus: vi.fn(
            (listener: (status: { state: string; progress?: SyncProgress }) => void) => {
                assetStatusListeners.add(listener);
                listener({ state: 'idle' });
                return () => assetStatusListeners.delete(listener);
            }
        )
    }
}));

describe('sync status stores', () => {
    beforeEach(() => {
        stopSyncStatusTracking();
        dataStatusListeners.clear();
        userStatusListeners.clear();
        multiStatusListeners.clear();
        assetStatusListeners.clear();
        dataSyncStatus.set({ state: 'idle' });
        userSyncStatus.set({ state: 'idle' });
        multiSyncStatus.set({ state: 'idle' });
        assetSyncStatus.set({ state: 'idle' });
    });

    it('should mirror sync engine statuses into store state', () => {
        startSyncStatusTracking();

        for (const listener of dataStatusListeners) {
            listener({ state: 'syncing' });
        }
        for (const listener of userStatusListeners) {
            listener({ state: 'network_error' });
        }
        for (const listener of multiStatusListeners) {
            listener({ state: 'auth_error' });
        }
        for (const listener of assetStatusListeners) {
            listener({ state: 'syncing', progress: { completed: 1, total: 3 } });
        }

        expect(get(dataSyncStatus)).toEqual({ state: 'syncing' });
        expect(get(userSyncStatus)).toEqual({ state: 'network_error' });
        expect(get(multiSyncStatus)).toEqual({ state: 'auth_error' });
        expect(get(assetSyncStatus)).toEqual({
            state: 'syncing',
            progress: { completed: 1, total: 3 }
        });
    });

    it('should reset stores when tracking stops', () => {
        startSyncStatusTracking();

        for (const listener of assetStatusListeners) {
            listener({ state: 'quota_error' });
        }

        stopSyncStatusTracking();

        expect(get(dataSyncStatus)).toEqual({ state: 'idle' });
        expect(get(userSyncStatus)).toEqual({ state: 'idle' });
        expect(get(multiSyncStatus)).toEqual({ state: 'idle' });
        expect(get(assetSyncStatus)).toEqual({ state: 'idle' });
    });
});
