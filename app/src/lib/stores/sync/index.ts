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

let stopBindings: (() => void) | null = null;

export function startSyncStoreBindings(): void {
    if (stopBindings) return;

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

    stopBindings = () => {
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
        stopBindings = null;
    };
}

export function stopSyncStoreBindings(): void {
    stopBindings?.();
}

export async function performResetSyncCursors(): Promise<void> {
    await SyncManager.resetCurrentCursors();
}
