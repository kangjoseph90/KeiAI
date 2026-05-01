/**
 * User Store
 *
 * UI imports these functions; they call UserService + update Svelte stores.
 */

import { get } from 'svelte/store';
import { appUser } from '$lib/adapters/user';
import { getActiveSession, UserService, type UserFields } from '$lib/services';
import { activeUser } from './state';
import type { DeepPartial } from '$lib/utils/defaults';

let stopUserWriteTracking: (() => void) | null = null;

/**
 * Load (or refresh) the current user's user record into the activeUser store.
 * Safe to call at any time - silently no-ops if the session isn't ready.
 */
export async function loadUser(): Promise<void> {
    try {
        const { userId } = getActiveSession();
        const user = await UserService.getUser(userId);
        activeUser.set(user);
    } catch {
        // Session may not be initialized yet
    }
}

/**
 * Update the current user's user fields.
 * Writes to local DB + triggers sync push via UserService.
 */
export async function updateUser(changes: DeepPartial<UserFields>): Promise<void> {
    const { userId } = getActiveSession();
    const updated = await UserService.updateUser(userId, changes);
    activeUser.set(updated);
}

/**
 * Keep activeUser fresh when the local user record changes.
 * This includes remote sync writes, so UserSyncEngine can stay store-agnostic.
 */
export function startUserTracking(): void {
    if (stopUserWriteTracking) return;

    stopUserWriteTracking = appUser.subscribeWriteEvents((events) => {
        const currentUser = get(activeUser);
        if (!currentUser) return;

        const shouldRefresh = events.some((event) => event.ids.includes(currentUser.id));
        if (shouldRefresh) {
            void loadUser();
        }
    });
}

export function stopUserTracking(): void {
    stopUserWriteTracking?.();
    stopUserWriteTracking = null;
}
