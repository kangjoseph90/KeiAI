import { AssetSyncService, DataSyncService, UserSyncService } from '$lib/services/sync';
import type { SyncStatus } from '$lib/services/sync/base';
import { assetSyncStatus, dataSyncStatus, userSyncStatus } from '../state';
import { startDataStoreSync, stopDataStoreSync } from './data';
import { startMultiStoreSync, stopMultiStoreSync } from './multi';
import { startUserStoreSync, stopUserStoreSync } from './user';

let stopTracking: (() => void) | null = null;

export function startSyncStatusTracking(): void {
    if (stopTracking) return;

    const unsubscribers = [
        DataSyncService.subscribeStatus((status: SyncStatus) => {
            dataSyncStatus.set(status);
        }),
        UserSyncService.subscribeStatus((status) => {
            userSyncStatus.set(status);
        }),
        AssetSyncService.subscribeStatus((status) => {
            assetSyncStatus.set(status);
        })
    ];

    startDataStoreSync();
    startUserStoreSync();
    startMultiStoreSync();

    stopTracking = () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }

        stopDataStoreSync();
        stopUserStoreSync();
        stopMultiStoreSync();

        dataSyncStatus.set({ state: 'idle' });
        userSyncStatus.set({ state: 'idle' });
        assetSyncStatus.set({ state: 'idle', pendingCount: 0 });
        stopTracking = null;
    };
}

export function stopSyncStatusTracking(): void {
    stopTracking?.();
}
