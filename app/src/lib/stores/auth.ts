/**
 * Auth Store
 *
 * Derived convenience stores for authentication state.
 * Source of truth is `activeUser` (from state.ts) + `pb.authStore`.
 */

import { derived, writable } from 'svelte/store';
import { pb } from '../core/api/pb.js';
import { activeUser } from './state.js';

// Re-export so views can import from a single module
export { activeUser };

// ─── PB Connection State ─────────────────────────────────────────────

/**
 * Tracks whether the PocketBase auth token is valid.
 * Updated automatically via pb.authStore.onChange().
 */
export const pbConnected = writable<boolean>(pb.authStore.isValid);

pb.authStore.onChange(() => {
	pbConnected.set(pb.authStore.isValid);
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
