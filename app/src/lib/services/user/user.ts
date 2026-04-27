/**
 * User Service — Local User Lifecycle
 *
 * Owns ALL local user record CRUD: local identity creation, sync-link user save,
 * sync unlinking, deletion, and account switching.
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
import { clock } from '$lib/utils/clock';
import { minidenticon } from 'minidenticons';
import { AppError } from '$lib/types/errors';
import { PB_URL } from '$lib/config';
import { pb } from '$lib/adapters/pb';

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
     * Restore the previously active user from local DB, or create a new local identity.
     * This is the app's boot entry point — called once from +page.svelte onMount.
     *
     * @returns true  — existing user was restored from local DB.
     * @returns false — local DB was empty; a fresh local identity was created.
     *                  Caller is responsible for clearing any stale PB auth token.
     */
    static async restoreOrCreateUser(): Promise<boolean> {
        const savedUserId = await appKV.get('activeUserId');

        if (savedUserId) {
            const user = await appUser.getUser(savedUserId);
            if (user && !user.isDeleted) {
                // Backfill identity key pair if the record predates this feature
                if (!user.identityKeyPair) {
                    const identityKeyPair = await generateIdentityKeyPair();
                    user.identityKeyPair = identityKeyPair;
                    user.updatedAt = clock.now();
                    await appUser.saveUser(user);
                }
                if (user.syncServerUrl) {
                    pb.baseUrl = user.syncServerUrl;
                } else {
                    pb.baseUrl = PB_URL;
                }
                setSession(user.id, user.masterKey, user.identityKeyPair);
                return true;
            }
        }
        await this.createUser();
        return false;
    }

    // ─── Local Identity Creation ─────────────────────────────────────

    /**
     * Create a brand new local-only user with a fresh master key.
     */
    static async createUser(): Promise<void> {
        const id = generateId();
        const masterKey = await generateMasterKey();
        const identityKeyPair = await generateIdentityKeyPair(); // private: extractable: true

        const existingUsers = await appUser.getAllUsers();
        const name = `Local ${existingUsers.length + 1}`;
        const avatar = this.getDefaultAvatarUrl(id);
        const now = clock.now();
        await appUser.saveUser({
            id,
            name,
            avatar,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            masterKey,
            identityKeyPair
        });

        await appKV.set('activeUserId', id);
        setSession(id, masterKey, identityKeyPair);
    }

    // ─── Login User Save ─────────────────────────────────────────────

    /**
     * Save or update a local user record after a successful PB login.
     * Called by AuthService connect/recovery flows — centralizes local record logic.
     */
    static async saveLoginUser(params: {
        id: string;
        username?: string;
        email?: string;
        masterKey: CryptoKey;
        identityKeyPair: CryptoKeyPair;
        syncServerUrl?: string;
        serverName?: string;
        avatarUrl?: string;
    }): Promise<void> {
        const existing = await appUser.getUser(params.id);
        const now = clock.now();

        await appUser.saveUser(
            {
                id: params.id,
                name: existing?.name ?? params.serverName ?? 'Synced Profile',
                username: params.username ?? existing?.username,
                email: params.email,
                avatar: existing?.avatar ?? params.avatarUrl ?? this.getDefaultAvatarUrl(params.id),
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                isDeleted: false,
                masterKey: params.masterKey,
                identityKeyPair: params.identityKeyPair,
                syncServerUrl: params.syncServerUrl ?? existing?.syncServerUrl ?? PB_URL
            },
            { origin: 'sync' }
        );

        await appKV.set('activeUserId', params.id);
        setSession(params.id, params.masterKey, params.identityKeyPair);
    }

    // ─── Sync Unlinking ──────────────────────────────────────────────

    /**
     * Disconnect local identity from a sync server.
     * Local data and keys remain intact.
     */
    static async unlinkSync(userId: string): Promise<void> {
        const user = await appUser.getUser(userId);
        if (!user) throw new AppError('NOT_FOUND', `User not found: ${userId}`);

        user.username = undefined;
        user.updatedAt = clock.now();
        await appUser.saveUser(user);

        setSession(userId, user.masterKey, user.identityKeyPair);
    }

    /**
     * Change the active user's sync server setting.
     * This is only allowed while disconnected from PB auth; callers should clear
     * the auth token before changing it. The username is server-scoped, so a
     * server change unlinks the cached remote account alias.
     */
    static async setSyncServerUrl(userId: string, syncServerUrl?: string): Promise<void> {
        const user = await appUser.getUser(userId);
        if (!user) throw new AppError('NOT_FOUND', `User not found: ${userId}`);

        const nextUrl = syncServerUrl?.trim() || undefined;
        if (user.syncServerUrl !== nextUrl) {
            user.username = undefined;
        }
        user.syncServerUrl = nextUrl;
        user.updatedAt = clock.now();
        await appUser.saveUser(user);

        pb.baseUrl = nextUrl ?? PB_URL;
        setSession(userId, user.masterKey, user.identityKeyPair);
    }

    // ─── Account Management ──────────────────────────────────────────

    /**
     * Switches the active session to another local account.
     * Updates KV and reloads the app to restart the boot sequence.
     */
    static async switchUser(userId: string): Promise<void> {
        pb.authStore.clear();
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
                { ...asset, isDeleted: true, updatedAt: clock.now() },
                { origin: 'sync' }
            );
        }

        const dbPromises = TABLES.map((table) => localDB.deleteByIndex(table, 'userId', userId));
        const kvPromises = TABLES.map((table) => appKV.remove(`lastSync_${table}_${userId}`));

        await Promise.all([...dbPromises, ...kvPromises]);

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
