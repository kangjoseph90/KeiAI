/**
 * User Service — Local User Lifecycle
 *
 * Owns ALL local user record CRUD: guest creation, login-based user save,
 * account unlinking (revert to guest), deletion, and account switching.
 * AuthService delegates local record management here.
 */

import { appUser, type UserRecord } from '$lib/adapters/user';
export type { UserRecord };
import { localDB, TABLES, SYNC_TABLES, type AssetRecord } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey } from '$lib/crypto';
import { generateId } from '$lib/shared/id';
import { setSession } from '../session';

export class UserService {
	// ─── Boot ────────────────────────────────────────────────────────

	/**
	 * Restore the previously active user from local DB, or create a new guest.
	 * This is the app's boot entry point — called once from +page.svelte onMount.
	 *
	 * @returns true  — existing user was restored from local DB.
	 * @returns false — local DB was empty; a fresh guest was created.
	 *                  Caller is responsible for clearing any stale PB auth token.
	 */
	static async restoreOrCreateGuest(): Promise<boolean> {
		const savedUserId = await appKV.get('activeUserId');

		if (savedUserId) {
			const user = await appUser.getUser(savedUserId);
			if (user && !user.isDeleted) {
				setSession(user.id, user.masterKey, user.isGuest);
				return true;
			}
		}

		await this.createGuest();
		return false;
	}

	// ─── Guest Creation ──────────────────────────────────────────────

	/**
	 * Create a brand new offline guest user with a fresh master key.
	 * The key is generated with extractable: true so that when the user
	 * registers, the raw bytes can be exported, wrapped with the
	 * password-derived key Y, and uploaded to the server.
	 */
	static async createGuest(): Promise<void> {
		const id = generateId();
		const guestKey = await generateMasterKey(); // extractable: true

		const existingUsers = await appUser.getAllUsers();
		const name = `Guest ${existingUsers.length + 1}`;
		const avatar = `https://api.dicebear.com/7.x/identicon/svg?seed=${id}`;

		await appUser.saveUser({
			id,
			name,
			avatar,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: true,
			masterKey: guestKey
		});

		await appKV.set('activeUserId', id);
		setSession(id, guestKey, true);
	}

	// ─── Login User Save ─────────────────────────────────────────────

	/**
	 * Save or update a local user record after a successful PB login.
	 * Called by AuthService.login() — centralizes all local record logic.
	 */
	static async saveLoginUser(params: {
		id: string;
		email: string;
		masterKey: CryptoKey;
		serverName?: string;
		avatarUrl?: string;
	}): Promise<void> {
		const existing = await appUser.getUser(params.id);

		await appUser.saveUser({
			id: params.id,
			name: existing?.name ?? params.serverName ?? 'Synced Profile',
			email: params.email,
			avatar:
				existing?.avatar ??
				params.avatarUrl ??
				`https://api.dicebear.com/7.x/identicon/svg?seed=${params.id}`,
			createdAt: existing?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: false,
			masterKey: params.masterKey
		});

		await appKV.set('activeUserId', params.id);
		setSession(params.id, params.masterKey, false);
	}

	// ─── Account Unlinking ───────────────────────────────────────────

	/**
	 * Revert a registered user back to guest state.
	 * Upgrades the local master key to extractable: true.
	 * Called by AuthService.unlinkAccount() after deleting the server account.
	 */
	static async revertToGuest(userId: string, unlockedKey: CryptoKey): Promise<void> {
		const user = await appUser.getUser(userId);
		if (!user) throw new Error('User not found.');

		user.masterKey = unlockedKey;
		user.isGuest = true;
		user.updatedAt = Date.now();
		await appUser.saveUser(user);

		setSession(userId, unlockedKey, true);
	}

	// ─── Account Management ──────────────────────────────────────────

	/**
	 * Switches the active session to another local account.
	 * Updates KV and reloads the app to restart the boot sequence.
	 */
	static async switchUser(userId: string): Promise<void> {
		await appKV.set('activeUserId', userId);
		window.location.reload();
	}

	/**
	 * Deletes a local account and all of its associated local data.
	 * This prevents orphaned encrypted data from consuming disk space.
	 */
	static async deleteUser(userId: string): Promise<void> {
		await appUser.deleteUser(userId);

		const userAssets = await localDB.getAll<AssetRecord>('assets', userId);
		for (const asset of userAssets) {
			await appStorage.delete(asset.id);
		}

		for (const table of TABLES) {
			await localDB.deleteByIndex(table, 'userId', userId);
		}

		for (const table of SYNC_TABLES) {
			await appKV.remove(`lastSync_${table}_${userId}`);
		}
	}

	/**
	 * Returns all local user records.
	 */
	static async getAllUsers() {
		return appUser.getAllUsers();
	}
}

export const userService = new UserService();
