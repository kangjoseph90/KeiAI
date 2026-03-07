/**
 * Profile Service
 *
 * Manages the current user's display profile (name, avatar).
 * Follows the same Service pattern as PersonaService, SettingsService, etc.
 *
 * Profile data is NOT encrypted (name/avatar are public display fields),
 * so this service talks directly to the `appUser` adapter instead of `localDB`.
 */

import { getActiveSession } from '../session.js';
import { appUser, type UserRecord } from '../../adapters/user/index.js';
import { ProfileSyncService } from '../sync/profile.js';
import { AppError } from '../../shared/errors.js';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ProfileFields {
	name: string;
	avatar: string;
}

export interface Profile extends ProfileFields {
	id: string;
	email?: string;
	isGuest: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────

export class ProfileService {
	/** Get the current user's profile. */
	static async get(): Promise<Profile> {
		const { userId } = getActiveSession();
		const user = await appUser.getUser(userId);
		if (!user) {
			throw new AppError('NOT_FOUND', `User not found: ${userId}`);
		}
		return this.toProfile(user);
	}

	/** Update the current user's profile fields. */
	static async update(changes: Partial<ProfileFields>): Promise<Profile> {
		const { userId } = getActiveSession();
		const user = await appUser.getUser(userId);
		if (!user) {
			throw new AppError('NOT_FOUND', `User not found: ${userId}`);
		}

		if (changes.name !== undefined) user.name = changes.name;
		if (changes.avatar !== undefined) user.avatar = changes.avatar;
		user.updatedAt = Date.now();

		await appUser.saveUser(user);

		// Fire-and-forget sync push (no-ops for guests / offline)
		void ProfileSyncService.pushProfile(user.name, changes.avatar);

		return this.toProfile(user);
	}

	/**
	 * Apply a server-sourced profile update to the local record.
	 * Used by ProfileSyncService when a Realtime event arrives.
	 * Only applies if the server timestamp is newer (LWW).
	 */
	static async applyRemoteUpdate(
		userId: string,
		remoteName: string,
		remoteAvatar: string,
		remoteUpdatedAt: number
	): Promise<Profile | null> {
		const user = await appUser.getUser(userId);
		if (!user) return null;

		// LWW - only apply if remote is strictly newer
		if (remoteUpdatedAt <= user.updatedAt) return null;

		user.name = remoteName;
		user.avatar = remoteAvatar;
		user.updatedAt = remoteUpdatedAt;
		await appUser.saveUser(user);

		return this.toProfile(user);
	}

	// ─── Helpers ──────────────────────────────────────────────────────────

	private static toProfile(user: UserRecord): Profile {
		return {
			id: user.id,
			name: user.name,
			avatar: user.avatar,
			email: user.email,
			isGuest: user.isGuest,
		};
	}
}
