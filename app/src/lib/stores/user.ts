/** Local user store actions. */

import {
    getActiveSession,
    AuthService,
    ConnectionService,
    UserService,
    hasActiveSession,
    purgeOrphanScopes,
    type UserFields
} from '$lib/services';
import { SyncManager } from '$lib/services/sync';
import { activeUser, localUsers } from './state';
import type { DeepPartial } from '$lib/utils/defaults';
import { appWindow } from '$lib/adapters/window';
import { resetRouteForReload } from '$lib/router';
import { startSyncStoreBindings, stopSyncStoreBindings } from './sync';

/**
 * Load (or refresh) the current user's user record into the activeUser store.
 * Safe to call at any time - silently no-ops if the session isn't ready.
 */
export async function loadUser(): Promise<void> {
    if (!hasActiveSession()) return;

    const { userId } = getActiveSession();
    const user = await UserService.getUser(userId);
    activeUser.set(user);
    await loadLocalUsers();
}

/**
 * Load every local identity for the account switcher.
 */
export async function loadLocalUsers(): Promise<void> {
    const users = await UserService.getAllUsers();
    localUsers.set(users.sort((a, b) => a.name.localeCompare(b.name)));
}

/**
 * Update the current user's user fields.
 * Writes to local DB + triggers sync push via UserService.
 */
export async function updateUser(changes: DeepPartial<UserFields>): Promise<void> {
    const { userId } = getActiveSession();
    const updated = await UserService.updateUser(userId, changes);
    activeUser.set(updated);
    await loadLocalUsers();
}

export async function performPurgeOrphans(): Promise<void> {
    await purgeOrphanScopes();
}

/**
 * Switch to another local identity. Reloading keeps scoped stores, sync state,
 * and route context from bleeding across users.
 */
export async function switchLocalUser(userId: string): Promise<void> {
    if (ConnectionService.isServerTransitionLocked()) return;

    const { userId: currentUserId } = getActiveSession();
    if (userId === currentUserId) return;

    await selectUserAndReload(currentUserId, () => UserService.selectUser(userId));
}

async function selectUserAndReload(
    currentUserId: string,
    selectNextUser: () => Promise<void>
): Promise<void> {
    stopSyncStoreBindings();
    SyncManager.stopAutoSync();
    AuthService.stopAutoRefresh();
    try {
        await AuthService.persistPbAuth(currentUserId);
        await selectNextUser();
        resetRouteForReload();
        await appWindow.reload();
    } catch (error) {
        await UserService.selectUser(currentUserId);
        startSyncStoreBindings();
        AuthService.startAutoRefresh();
        SyncManager.startAutoSync();
        throw error;
    }
}

/** Create a local identity and select it for the next boot. */
export async function createAndSwitchLocalUser(): Promise<void> {
    if (ConnectionService.isServerTransitionLocked()) return;

    const { userId: currentUserId } = getActiveSession();
    await selectUserAndReload(currentUserId, async () => {
        const user = await UserService.createUser();
        await UserService.selectUser(user.id);
    });
}

/** Delete the active local identity and continue with another or a fresh identity. */
export async function deleteActiveLocalUser(): Promise<void> {
    if (ConnectionService.isServerTransitionLocked()) return;

    const { userId } = getActiveSession();
    const localUsers = await UserService.getAllUsers();
    const fallback = localUsers.find((user) => user.id !== userId);
    stopSyncStoreBindings();
    SyncManager.stopAutoSync();
    AuthService.stopAutoRefresh();
    try {
        await AuthService.clearAllPbAuthForUser(userId);
        await UserService.deleteUser(userId);

        if (fallback) {
            await UserService.selectUser(fallback.id);
        } else {
            const user = await UserService.createUser();
            await UserService.selectUser(user.id);
        }
    } catch (error) {
        // Deletion spans multiple stores and cannot be rolled back safely; reboot into what remains.
        resetRouteForReload();
        await appWindow.reload();
        throw error;
    }
    resetRouteForReload();
    await appWindow.reload();
}
