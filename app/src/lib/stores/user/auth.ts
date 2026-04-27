/**
 * Auth Store — Derived auth state + auth action functions.
 *
 * Derived stores: isLoggedIn, isLocalOnly, userEmail, userId, pbConnected.
 * Action functions: performCreateAccount, performSignIn, performRecoverAndReset,
 *   performChangePassword, performUnlinkSync, performLogout, performDeleteWithRecoveryCode.
 *
 * Action functions wrap AuthService calls and handle post-auth store refresh.
 * UI components call these instead of AuthService directly — this keeps
 * core/api free of store imports (no layer violation).
 *
 * Imports from individual store files (not the barrel) to avoid circular deps,
 * since stores/index.ts re-exports from this file indirectly via views.
 */

import { activeUser, pbConnected } from '../state';
import { AuthService, UserService } from '$lib/services';
import { SyncManager } from '$lib/services/sync';
import { loadProfile } from './profile';
import { clearActiveCharacter } from '../content/character';
import { loadGlobalState } from '../init';
import { getActiveSession } from '$lib/services/session';

// ─── PB Connection State ─────────────────────────────────────────────

pbConnected.set(AuthService.isPbConnected());

AuthService.onPbAuthChange((isValid) => {
    pbConnected.set(isValid);
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Refresh all store state after a login/register/recover/change-password.
 * Syncs remote data, then reloads every global list so the UI reflects the
 * newly authenticated user's data.
 */
async function refreshAfterLogin(): Promise<void> {
    void loadProfile();
    await SyncManager.syncAll();
    clearActiveCharacter();
    await loadGlobalState();
}

// ─── Auth Actions ────────────────────────────────────────────────────

export async function performCreateAccount(
    username: string,
    password: string,
    email?: string
): Promise<string> {
    const recoveryCode = await AuthService.createAccount(username, password, email);
    await refreshAfterLogin();
    return recoveryCode;
}

export async function performSignIn(username: string, password: string): Promise<void> {
    await AuthService.signIn(username, password);
    await refreshAfterLogin();
}

export async function performRecoverAndReset(
    recoveryCode: string,
    newPassword: string
): Promise<string> {
    const newCode = await AuthService.recoverAndResetPassword(recoveryCode, newPassword);
    await refreshAfterLogin();
    return newCode;
}

export async function performDeleteWithRecoveryCode(recoveryCode: string): Promise<void> {
    await AuthService.deleteAccountWithRecoveryCode(recoveryCode);
    await performUnlinkSync();
}

export async function performPairWithCode(pairingCode: string): Promise<void> {
    await AuthService.connectWithPairingCode(pairingCode);
    await refreshAfterLogin();
}

export async function performSetSyncServerUrl(syncServerUrl?: string): Promise<void> {
    AuthService.clearAuth();
    pbConnected.set(false);
    const { userId } = getActiveSession();
    await UserService.setSyncServerUrl(userId, syncServerUrl);
    await loadProfile();
}

export async function performChangePassword(
    oldPassword: string,
    newPassword: string
): Promise<string> {
    const newCode = await AuthService.changePassword(oldPassword, newPassword);
    await refreshAfterLogin();
    return newCode;
}

export async function performUnlinkSync(): Promise<void> {
    await AuthService.unlinkSync();
    void loadProfile();
}

export async function performLogout(): Promise<void> {
    await AuthService.logout();
    void loadProfile();
}

/**
 * Create a new local account: stop sync, clear PB auth, clear activeUserId, reload.
 * After reload, restoreOrCreateUser() will create a fresh local identity and initDefaultContents()
 * will be called with clean store state.
 */
export async function performCreateNewUser(): Promise<void> {
    SyncManager.stopAutoSync();
    AuthService.clearAuth();
    await UserService.switchUser(''); // Clear activeUserId KV and reload
}
