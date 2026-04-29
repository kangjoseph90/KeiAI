/**
 * User Service — Local User Lifecycle
 *
 * Owns local user record persistence and the active in-memory session:
 * local identity creation, sync-link user saves, user field updates, local
 * deletion, active-user KV selection, and key-backed session activation.
 * PB auth, sync server selection, and page reload orchestration live above this layer.
 */

import { appUser, type UserRecord } from '$lib/adapters/user';
export type { UserRecord };
import { appAsset } from '$lib/adapters/asset';
import { localDB, TABLES } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey, generateIdentityKeyPair } from '$lib/crypto';
import { generateId } from '$lib/utils/id';
import { clock } from '$lib/utils/clock';
import { minidenticon } from 'minidenticons';
import { AppError } from '$lib/types/errors';
import { PB_URL } from '$lib/config';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';

export interface UserFields {
    name: string;
    username?: string;
    avatar: string;
    email?: string;
    syncServerUrl?: string;
}

export interface User extends UserFields {
    id: string;
}

export interface Session {
    userId: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
}

let activeSession: Session | null = null;

function getDefaultAvatarUrl(seed: string): string {
    const svg = minidenticon(seed);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function toUser(user: UserRecord): User {
    return {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        email: user.email,
        syncServerUrl: user.syncServerUrl
    };
}

export function hasActiveSession(): boolean {
    return activeSession !== null;
}

export function getActiveSession(): Session {
    if (activeSession) {
        return activeSession;
    }
    throw new AppError('NOT_FOUND', `Active session not found`);
}

export class UserService {
    /**
     * Persist the active user ID and activate the in-memory session.
     * Pass an empty string to clear the KV (e.g. before page reload for new user creation).
     */
    static async setActiveUser(userId: string): Promise<void> {
        if (!userId) return this.clearActiveUser();
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        activeSession = {
            userId,
            masterKey: user.masterKey,
            identityKeyPair: user.identityKeyPair
        };
        await appKV.set('activeUserId', userId);
    }

    static async clearActiveUser(): Promise<void> {
        activeSession = null;
        await appKV.set('activeUserId', '');
    }

    /** Get a user view by local user ID. */
    static async getUser(userId: string): Promise<User> {
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        return toUser(user);
    }

    /**
     * Returns all local user records.
     */
    static async getAllUsers() {
        return appUser.getAllUsers();
    }

    /**
     * Restore the previously active user from local DB, or create a new local identity.
     * This is the app's boot entry point — called once from +page.svelte onMount.
     *
     * @returns restored — whether an existing user was restored from local DB.
     */
    static async restoreOrCreateUser(): Promise<{ user: UserRecord; restored: boolean }> {
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
                return { user, restored: true };
            }
        }
        const user = await this.createUser();
        return { user, restored: false };
    }

    /**
     * Create a brand new local-only user with a fresh master key.
     */
    static async createUser(): Promise<UserRecord> {
        const id = generateId();
        const masterKey = await generateMasterKey();
        const identityKeyPair = await generateIdentityKeyPair(); // private: extractable: true

        const existingUsers = await appUser.getAllUsers();
        const name = `Local ${existingUsers.length + 1}`;
        const avatar = getDefaultAvatarUrl(id);
        const now = clock.now();
        const user: UserRecord = {
            id,
            name,
            avatar,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            masterKey,
            identityKeyPair
        };

        await appUser.saveUser(user);
        return user;
    }

    static async saveUser(params: {
        id: string;
        username?: string;
        email?: string;
        masterKey: CryptoKey;
        identityKeyPair: CryptoKeyPair;
        syncServerUrl?: string;
        serverName?: string;
        avatarUrl?: string;
    }): Promise<UserRecord> {
        const existing = await appUser.getUser(params.id);
        const now = clock.now();

        const user: UserRecord = {
            id: params.id,
            name: existing?.name ?? params.serverName ?? 'Synced User',
            username: params.username ?? existing?.username,
            email: params.email,
            avatar: existing?.avatar ?? params.avatarUrl ?? getDefaultAvatarUrl(params.id),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            isDeleted: false,
            masterKey: params.masterKey,
            identityKeyPair: params.identityKeyPair,
            syncServerUrl: params.syncServerUrl ?? existing?.syncServerUrl ?? PB_URL
        };

        await appUser.saveUser(user, { origin: 'sync' });
        return user;
    }

    /** Update a user view by local user ID. */
    static async updateUser(userId: string, changes: DeepPartial<UserFields>): Promise<User> {
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }

        const updated = deepMerge(user, changes);
        updated.updatedAt = clock.now();

        await appUser.saveUser(updated);
        return toUser(updated);
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
            await appAsset.deleteAsset(asset.id, { origin: 'sync' });
        }

        const dbPromises = TABLES.map((table) => localDB.deleteByIndex(table, 'userId', userId));
        const kvPromises = TABLES.map((table) => appKV.remove(`lastSync_${table}_${userId}`));

        await Promise.all([...dbPromises, ...kvPromises]);
    }
}
