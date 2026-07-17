/**
 * User Store
 *
 * UI imports these functions; they call UserService + update Svelte stores.
 */

import {
    getActiveSession,
    ConnectionService,
    toUser,
    UserService,
    type UserFields
} from '$lib/services';
import { SyncManager } from '$lib/services/sync';
import { activeUser, localUsers } from './state';
import type { DeepPartial } from '$lib/utils/defaults';
import { initDefaultContents } from './init';
import { appWindow } from '$lib/adapters/window';

/**
 * Load (or refresh) the current user's user record into the activeUser store.
 * Safe to call at any time - silently no-ops if the session isn't ready.
 */
export async function loadUser(): Promise<void> {
    try {
        const { userId } = getActiveSession();
        const user = await UserService.getUser(userId);
        activeUser.set(user);
        await loadLocalUsers();
    } catch {
        // Session may not be initialized yet
    }
}

/**
 * Load every local identity for the account switcher.
 */
export async function loadLocalUsers(): Promise<void> {
    const users = await UserService.getAllUsers();
    localUsers.set(users.map(toUser).sort((a, b) => a.name.localeCompare(b.name)));
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

/**
 * Switch to another local identity. Reloading keeps scoped stores, sync state,
 * and route context from bleeding across users.
 */
export async function switchLocalUser(userId: string): Promise<void> {
    if (ConnectionService.isServerTransitionLocked()) return;

    const { userId: currentUserId } = getActiveSession();
    if (userId === currentUserId) return;

    SyncManager.stopAutoSync();
    await UserService.setActiveUser(userId);
    await appWindow.reload();
}

/**
 * Create a fresh local identity, seed its default content, and make it active.
 */
export async function createAndSwitchLocalUser(): Promise<void> {
    if (ConnectionService.isServerTransitionLocked()) return;

    SyncManager.stopAutoSync();
    const user = await UserService.createUser();
    await UserService.setActiveUser(user.id);
    await initDefaultContents();
    await appWindow.reload();
}
