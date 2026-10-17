import {
    AssetSyncEngine,
    DataRecordSyncEngine,
    MultiRecordSyncEngine,
    SyncManager,
    UserRecordSyncEngine
} from '$lib/services/sync';
import type { SyncStatus } from '$lib/services/sync/base';
import type { SyncConflict, SyncConflictChoice } from '$lib/services/sync';
import {
    assetSyncStatus,
    dataSyncStatus,
    multiSyncStatus,
    syncConflicts,
    userSyncStatus
} from '../state';
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
        DataRecordSyncEngine.subscribeConflicts((conflicts) => {
            syncConflicts.set(conflicts);
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
        syncConflicts.set([]);
        stopBindings = null;
    };
}

export function stopSyncStoreBindings(): void {
    stopBindings?.();
}

/** Replace one replica of a conflicted scope with the other; see DataRecordSyncEngine. */
export async function resolveSyncConflict(
    conflict: SyncConflict,
    choice: SyncConflictChoice
): Promise<void> {
    await DataRecordSyncEngine.resolveConflict(conflict, choice);
}

export async function performResetSyncCursors(): Promise<void> {
    await SyncManager.resetCurrentCursors();
}
