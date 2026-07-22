import {
    AssetSyncEngine,
    DataRecordSyncEngine,
    MultiRecordSyncEngine,
    SyncManager,
    UserRecordSyncEngine
} from '$lib/services/sync';
import type { SyncStatus } from '$lib/services/sync/base';
import { assetSyncStatus, dataSyncStatus, multiSyncStatus, userSyncStatus } from '../state';
import { startDataStoreSync, stopDataStoreSync } from './data';
import { startMultiStoreSync, stopMultiStoreSync } from './multi';
import { startUserStoreSync, stopUserStoreSync } from './user';

let stopTracking: (() => void) | null = null;

export function startSyncStatusTracking(): void {
    if (stopTracking) return;

    const unsubscribers = [
        DataRecordSyncEngine.subscribeStatus((status: SyncStatus) => {
            dataSyncStatus.set(status);
        }),
        UserRecordSyncEngine.subscribeStatus((status) => {
            userSyncStatus.set(status);
        }),
        MultiRecordSyncEngine.subscribeStatus((status) => {
            multiSyncStatus.set(status);
        }),
        AssetSyncEngine.subscribeStatus((status) => {
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
        multiSyncStatus.set({ state: 'idle' });
        assetSyncStatus.set({ state: 'idle' });
        stopTracking = null;
    };
}

export function stopSyncStatusTracking(): void {
    stopTracking?.();
}

export async function performResetSyncCursors(): Promise<void> {
    await SyncManager.resetCurrentCursors();
}
