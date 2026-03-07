/**
 * Profile Store
 *
 * Follows the same Store pattern as persona.ts, settings.ts, etc.
 * UI imports these functions; they call ProfileService + update Svelte stores.
 *
 * Imports ProfileSyncService directly from sync/profile.js (not the barrel)
 * to avoid circular references: stores → sync, never sync → stores.
 */

import { ProfileService, type ProfileFields, type Profile } from '../services/profile.js';
import { ProfileSyncService } from '../core/api/sync/profile.js';
import { activeUser } from './state.js';
import { getActiveSession } from '../session.js';
import { pb } from '../core/api/pb.js';

/**
 * Load (or refresh) the current user's profile into the activeUser store.
 * Safe to call at any time - silently no-ops if the session isn't ready.
 */
export async function loadProfile(): Promise<void> {
	try {
		const profile = await ProfileService.get();
		activeUser.set(profile);
	} catch {
		// Session may not be initialized yet
	}
}

/**
 * Update the current user's profile (name, avatar).
 * Writes to local DB first, then fires off a server push.
 */
export async function updateProfile(changes: Partial<ProfileFields>): Promise<void> {
	const updated = await ProfileService.update(changes);
	activeUser.set(updated);

	// Fire-and-forget push to server (only for registered users)
	const { isGuest } = getActiveSession();
	if (!isGuest && pb.authStore.isValid) {
		void ProfileSyncService.pushProfile(updated.name, changes.avatar);
	}
}
