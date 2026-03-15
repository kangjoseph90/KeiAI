/**
 * User Service — Local User Lifecycle
 *
 * Owns ALL local user record CRUD: guest creation, login-based user save,
 * account unlinking (revert to guest), deletion, and account switching.
 * AuthService delegates local record management here.
 */

import { appUser, type UserRecord } from '$lib/adapters/user';
export type { UserRecord };
import { appAsset, type AssetRecord } from '$lib/adapters/asset';
import { localDB, TABLES } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey, generateIdentityKeyPair } from '$lib/crypto';
import { generateId } from '$lib/utils/id';
import { setSession } from '../session';
import { minidenticon } from 'minidenticons';
import { AppError } from '$lib/types/errors';

export class UserService {
	/**
	 * Returns a default avatar URL for a given seed (usually user ID).
	 */
	static getDefaultAvatarUrl(seed: string): string {
		const svg = minidenticon(seed);
		return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
	}

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
				// Backfill identity key pair if the record predates this feature
				if (!user.identityKeyPair) {
					const identityKeyPair = await generateIdentityKeyPair();
					user.identityKeyPair = identityKeyPair;
					user.updatedAt = Date.now();
					await appUser.saveUser(user);
				}
				setSession(user.id, user.masterKey, user.isGuest, user.identityKeyPair);
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
		const identityKeyPair = await generateIdentityKeyPair(); // private: extractable: true

		const existingUsers = await appUser.getAllUsers();
		const name = `Guest ${existingUsers.length + 1}`;
		const avatar = this.getDefaultAvatarUrl(id);

		await appUser.saveUser({
			id,
			name,
			avatar,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: true,
			masterKey: guestKey,
			identityKeyPair
		});

		await appKV.set('activeUserId', id);
		setSession(id, guestKey, true, identityKeyPair);
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
		identityKeyPair: CryptoKeyPair;
		serverName?: string;
		avatarUrl?: string;
	}): Promise<void> {
		const existing = await appUser.getUser(params.id);

		await appUser.saveUser(
			{
				id: params.id,
				name: existing?.name ?? params.serverName ?? 'Synced Profile',
				email: params.email,
				avatar: existing?.avatar ?? params.avatarUrl ?? this.getDefaultAvatarUrl(params.id),
				createdAt: existing?.createdAt ?? Date.now(),
				updatedAt: Date.now(),
				isDeleted: false,
				isGuest: false,
				masterKey: params.masterKey,
				identityKeyPair: params.identityKeyPair
			},
			{ origin: 'sync' }
		);

		await appKV.set('activeUserId', params.id);
		setSession(params.id, params.masterKey, false, params.identityKeyPair);
	}

	// ─── Account Unlinking ───────────────────────────────────────────

	/**
	 * Revert a registered user back to guest state.
	 * Upgrades the local master key to extractable: true.
	 * Called by AuthService.unlinkAccount() after deleting the server account.
	 */
	static async revertToGuest(userId: string, unlockedKey: CryptoKey): Promise<void> {
		const user = await appUser.getUser(userId);
		if (!user) throw new AppError('NOT_FOUND', `User not found: ${userId}`);

		user.masterKey = unlockedKey;
		user.isGuest = true;
		user.updatedAt = Date.now();
		await appUser.saveUser(user);

		setSession(userId, unlockedKey, true, user.identityKeyPair);
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
		await appUser.deleteUser(userId, { origin: 'sync' });

		// Purge all asset artifacts for this user
		const [assets, registry] = await Promise.all([
			appAsset.getAllAssets(userId),
			appAsset.getAllRegistry(userId)
		]);
		const ids = new Set<string>([...assets.map((r) => r.id), ...registry.map((r) => r.id)]);
		for (const id of ids) {
			await appStorage.delete(`assets/${id}`).catch(() => undefined);
			await appAsset.deleteRegistry(id, { origin: 'sync' }).catch(() => undefined);
		}
		// Hard-delete all asset metadata records
		for (const asset of assets) {
			await appAsset.putAsset(
				{ ...asset, isDeleted: true, updatedAt: Date.now() },
				{ origin: 'sync' }
			);
		}

		for (const table of TABLES) {
			await localDB.deleteByIndex(table, 'userId', userId);
		}

		for (const table of TABLES) {
			await appKV.remove(`lastSync_${table}_${userId}`);
		}

		// Asset sync has its own cursor (separate from DataSyncEngine)
		await appKV.remove(`lastSync_assets_${userId}`);
	}

	/**
	 * Returns all local user records.
	 */
	static async getAllUsers() {
		return appUser.getAllUsers();
	}
}
