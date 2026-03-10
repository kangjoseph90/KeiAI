import { AssetSyncService, DataSyncService, ProfileSyncService } from '$lib/services/sync';
import { assetSyncStatus, dataSyncStatus, profileSyncStatus } from './state';

let stopTracking: (() => void) | null = null;

export function startSyncStatusTracking(): void {
	if (stopTracking) return;

	const unsubscribers = [
		DataSyncService.subscribeStatus((status) => {
			dataSyncStatus.set(status);
		}),
		ProfileSyncService.subscribeStatus((status) => {
			profileSyncStatus.set(status);
		}),
		AssetSyncService.subscribeStatus((status) => {
			assetSyncStatus.set(status);
		})
	];

	stopTracking = () => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}

		dataSyncStatus.set({ state: 'idle' });
		profileSyncStatus.set({ state: 'idle' });
		assetSyncStatus.set({ state: 'idle', pendingCount: 0 });
		stopTracking = null;
	};
}

export function stopSyncStatusTracking(): void {
	stopTracking?.();
}
