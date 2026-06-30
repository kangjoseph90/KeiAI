/**
 * Auth Store — Derived auth state + auth action functions.
 *
 * Derived stores: isLoggedIn, isLocalOnly, userEmail, userId, pbConnected.
 * Action functions: performCreateAccount, performSignIn, performRecoverAndReset,
 *   performChangePassword, performUnlinkSync, performLogout,
 *   performDeleteWithRecoveryCode, performSetSelfHostUrl.
 *
 * Action functions wrap AuthService calls and handle post-auth store refresh.
 * UI components call these instead of AuthService directly — this keeps
 * core/api free of store imports (no layer violation).
 *
 * Imports from individual store files (not the barrel) to avoid circular deps,
 * since stores/index.ts re-exports from this file indirectly via views.
 */

import { activeUser, migrationLocked, pbConnected } from './state';
import { AuthService, MigrationService, UserService, type MigrationOptions } from '$lib/services';
import { SyncManager } from '$lib/services/sync';
import { loadUser } from './user';
import { clearActiveCharacter } from './content/character';
import { clearActivePersona } from './content/persona';
import { loadGlobalState } from './init';

// ─── PB Connection State ─────────────────────────────────────────────

pbConnected.set(AuthService.isPbConnected());

AuthService.onPbAuthChange((isValid) => {
    pbConnected.set(isValid);
});

MigrationService.onLockChange((locked) => {
    migrationLocked.set(locked);
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Refresh all store state after a login/register/recover/change-password.
 * Syncs remote data, then reloads every global list so the UI reflects the
 * newly authenticated user's data.
 */
async function refreshAfterLogin(): Promise<void> {
    await loadUser();
    SyncManager.startAutoSync();
    await SyncManager.syncAll();
    clearActiveCharacter();
    clearActivePersona();
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

export async function performSetSelfHostUrl(
    selfHostUrl?: string,
    options?: MigrationOptions
): Promise<void> {
    const nextUrl = selfHostUrl?.trim() || undefined;
    if (nextUrl) {
        await MigrationService.enterSelfHost(nextUrl, options);
    } else {
        await MigrationService.leaveSelfHost(options);
    }
    await loadUser();
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
    void loadUser();
}

export async function performLogout(): Promise<void> {
    await AuthService.logout();
    void loadUser();
}

/**
 * Create a new local account: stop sync, clear PB auth, clear activeUserId, reload.
 * After reload, restoreOrCreateUser() will create a fresh local identity and initDefaultContents()
 * will be called with clean store state.
 */
export async function performCreateNewUser(): Promise<void> {
    SyncManager.stopAutoSync();
    await UserService.setActiveUser(''); // Clear activeUserId KV and reload
    window.location.reload();
}
