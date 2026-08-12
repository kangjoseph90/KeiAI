/** Authentication actions and their store lifecycle boundaries. */

import { pbConnected } from './state';
import { AuthService, UserService, getActiveSession } from '$lib/services';
import { appWindow } from '$lib/adapters/window';
import { SyncManager } from '$lib/services/sync';
import { loadUser } from './user';
import { clearActiveCharacter } from './content/character';
import { clearActivePersona } from './content/persona';
import { loadGlobalState } from './init';
import { resetRouteForReload } from '$lib/router';
import { startSyncStoreBindings, stopSyncStoreBindings } from './sync';

// ─── PB Connection State ─────────────────────────────────────────────

pbConnected.set(AuthService.isPbConnected());

AuthService.onPbAuthChange((isValid) => {
    pbConnected.set(isValid);
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function refreshAuthenticatedUser(): Promise<void> {
    await loadUser();
    SyncManager.startAutoSync();
    await SyncManager.syncAll();
    clearActiveCharacter();
    clearActivePersona();
    await loadGlobalState();
}

async function runAuthTransition<T>(action: () => Promise<T>): Promise<T> {
    const { userId } = getActiveSession();
    stopSyncStoreBindings();
    SyncManager.stopAutoSync();
    AuthService.stopAutoRefresh();
    let result: T;
    try {
        await AuthService.persistPbAuth(userId);
        result = await action();
        if (await UserService.isUserSwitchPending()) {
            resetRouteForReload();
            await appWindow.reload();
            return result;
        }
    } catch (error) {
        await UserService.selectUser(userId);
        await AuthService.restorePbAuth(userId);
        startSyncStoreBindings();
        AuthService.startAutoRefresh();
        SyncManager.startAutoSync();
        throw error;
    }
    startSyncStoreBindings();
    AuthService.startAutoRefresh();
    await refreshAuthenticatedUser();
    return result;
}

// ─── Auth Actions ────────────────────────────────────────────────────

export async function performCreateAccount(
    username: string,
    password: string,
    email?: string
): Promise<string> {
    return runAuthTransition(() => AuthService.createAccount(username, password, email));
}

export async function performSignIn(username: string, password: string): Promise<void> {
    await runAuthTransition(() => AuthService.signIn(username, password));
}

export async function performRecoverAndReset(
    recoveryCode: string,
    newPassword: string
): Promise<string> {
    // Recovery resets remote credentials but does not replace the active local identity.
    return AuthService.recoverAndResetPassword(recoveryCode, newPassword);
}

export async function performDeleteWithRecoveryCode(recoveryCode: string): Promise<void> {
    await AuthService.deleteAccountWithRecoveryCode(recoveryCode);
    await loadUser();
}

export async function performPairWithCode(pairingCode: string): Promise<void> {
    await runAuthTransition(() => AuthService.connectWithPairingCode(pairingCode));
}

export async function performChangePassword(
    oldPassword: string,
    newPassword: string
): Promise<string> {
    return runAuthTransition(() => AuthService.changePassword(oldPassword, newPassword));
}

export async function performLogout(): Promise<void> {
    await AuthService.logout();
}
