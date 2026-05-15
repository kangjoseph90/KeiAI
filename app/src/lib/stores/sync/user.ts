import { get } from 'svelte/store';
import { appUser } from '$lib/adapters/user';
import { activeUser } from '../state';
import { loadUser } from '../user';

let stopUserStoreSyncListener: (() => void) | null = null;

export function startUserStoreSync(): void {
    if (stopUserStoreSyncListener) return;

    stopUserStoreSyncListener = appUser.subscribeWriteEvents((events) => {
        const currentUser = get(activeUser);
        if (!currentUser) return;

        const shouldRefresh = events.some((event) => event.ids.includes(currentUser.id));
        if (shouldRefresh) {
            void loadUser();
        }
    });
}

export function stopUserStoreSync(): void {
    stopUserStoreSyncListener?.();
    stopUserStoreSyncListener = null;
}
