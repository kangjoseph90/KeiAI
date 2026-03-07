/**
 * Auth Store — Derived auth state + auth action functions.
 *
 * Derived stores: isLoggedIn, isGuest, userEmail, userId, pbConnected.
 * Action functions: performLogin, performRegister, performRecoverPassword,
 *   performChangePassword, performUnlink, performLogout.
 *
 * Action functions wrap AuthService calls and handle post-auth store refresh.
 * UI components call these instead of AuthService directly — this keeps
 * core/api free of store imports (no layer violation).
 *
 * Imports from individual store files (not the barrel) to avoid circular deps,
 * since stores/index.ts re-exports from this file indirectly via views.
 */

import { pbConnected } from '../state';
import { AuthService } from '$lib/services/user/auth';
import { SyncManager } from '$lib/services/sync';
import { UserService } from '$lib/services/user/user';
import { loadProfile } from './profile';
import { clearActiveCharacter } from '../content/character';
import { loadGlobalState } from '../init';

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

export async function performLogin(email: string, password: string): Promise<void> {
	await AuthService.login(email, password);
	await refreshAfterLogin();
}

export async function performRegister(email: string, password: string): Promise<string> {
	const recoveryCode = await AuthService.register(email, password);
	await refreshAfterLogin();
	return recoveryCode;
}

export async function performRecoverPassword(
	email: string,
	recoveryCode: string,
	newPassword: string
): Promise<string> {
	const newCode = await AuthService.recoverPassword(email, recoveryCode, newPassword);
	await refreshAfterLogin();
	return newCode;
}

export async function performChangePassword(
	oldPassword: string,
	newPassword: string
): Promise<string> {
	const newCode = await AuthService.changePassword(oldPassword, newPassword);
	await refreshAfterLogin();
	return newCode;
}

export async function performUnlink(password: string): Promise<void> {
	await AuthService.unlinkAccount(password);
	void loadProfile();
}

export async function performLogout(): Promise<void> {
	await AuthService.logout();
	void loadProfile();
}

/**
 * Create a new guest area: stop sync, clear PB auth, create guest, reload.
 * Called from ManageAccountsDialog — orchestrates network + service layers.
 */
export async function performCreateNewGuest(): Promise<void> {
	SyncManager.stopAutoSync();
	AuthService.clearAuth();
	await UserService.createGuest();
	window.location.reload();
}
