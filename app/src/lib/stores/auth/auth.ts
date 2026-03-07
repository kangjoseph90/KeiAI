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

import { derived, writable } from 'svelte/store';
import { activeUser } from '../state.js';
import { AuthService } from '../../services/auth/auth.js';
import { SyncManager } from '../../services/sync/index.js';
import { UserService } from '../../services/auth/user.js';
import { loadProfile } from './profile.js';
import { loadSettings } from '../content/settings.js';
import { loadCharacters, clearActiveCharacter } from '../content/character.js';
import { loadModules } from '../content/module.js';
import { loadPlugins } from '../content/plugin.js';
import { loadPersonas } from '../content/persona.js';
import { loadPresets } from '../content/preset.js';

// Re-export so views can import from a single module
export { activeUser };

// ─── PB Connection State ─────────────────────────────────────────────

/**
 * Tracks whether the PocketBase auth token is valid.
 * Updated automatically via pb.authStore.onChange().
 */
export const pbConnected = writable<boolean>(AuthService.isPbConnected());

AuthService.onPbAuthChange((isValid) => {
	pbConnected.set(isValid);
});

// ─── Derived Auth State ──────────────────────────────────────────────

/** True when the user has a valid PB session (registered + token valid). */
export const isLoggedIn = derived(
	[activeUser, pbConnected],
	([user, connected]) => user !== null && !user.isGuest && connected
);

/** The user's email (from local profile, cached from PB). */
export const userEmail = derived(activeUser, (u) => u?.email ?? null);

/** The active user's ID. */
export const userId = derived(activeUser, (u) => u?.id ?? null);

/** Whether the active user is a guest. */
export const isGuest = derived(activeUser, (u) => u?.isGuest ?? true);

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
	await loadSettings();
	await Promise.all([
		loadModules(),
		loadPlugins(),
		loadPersonas(),
		loadPresets(),
		loadCharacters()
	]);
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
