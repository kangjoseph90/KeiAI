/**
 * User Service — Local User Lifecycle
 *
 * Owns local user record persistence:
 * local identity creation, sync-link user saves, user field updates, local
 * deletion, active-user KV selection, and key-backed session activation.
 * PB auth, sync server selection, and page reload orchestration live above this layer.
 */

import { appUser, type UserRecord } from '$lib/adapters/user';
export type { UserRecord };
import { clearSession, getActiveSession, setUserSession } from './session';
export type { MultiRoomSession, Session, UserSession } from './session';
import { localDB, TABLES } from '$lib/adapters/db';
import { appMulti } from '$lib/adapters/multi';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey, generateIdentityKeyPair } from '$lib/crypto';
import { generateId } from '$lib/utils/id';
import { clock } from '$lib/utils/clock';
import { minidenticon } from 'minidenticons';
import { AppError } from '$lib/types/errors';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { pb } from '$lib/adapters/pb';
import { buffer } from './content/record_buffer';
import { AssetService } from './asset';
import { createDefaultUserConnections, type UserConnectionSettings } from '$lib/types/connections';
import {
    applyUserConnectionRuntime,
    resetConnectionRuntime,
    resolveServerUrl
} from './connection/runtime';

export interface UserFields {
    name: string;
    avatar: string;
    username?: string;
    email?: string;
}

export interface User extends UserFields {
    id: string;
    connections: UserConnectionSettings;
}

function getDefaultAvatarUrl(seed: string): string {
    const svg = minidenticon(seed);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function toUser(user: UserRecord): User {
    return {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        connections: user.connections,
        username: user.username,
        email: user.email
    };
}

export class UserService {
    /**
     * Persist the active user ID and activate the in-memory session.
     * Pass an empty string to clear the KV (e.g. before page reload for new user creation).
     */
    static async setActiveUser(
        userId: string,
        options: { preserveAuth?: boolean } = {}
    ): Promise<void> {
        if (!userId) return this.clearActiveUser();
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        setUserSession({
            userId,
            masterKey: user.masterKey,
            identityKeyPair: user.identityKeyPair
        });
        await appKV.set('activeUserId', userId);
        applyUserConnectionRuntime(user.connections);
        if (!options.preserveAuth) {
            pb.authStore.clear();
        }
    }

    static async clearActiveUser(): Promise<void> {
        clearSession();
        await appKV.set('activeUserId', '');
        resetConnectionRuntime();
        pb.authStore.clear();
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
            if (user) {
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
            masterKey,
            identityKeyPair,
            connections: createDefaultUserConnections()
        };

        await appUser.saveUser(user);
        return user;
    }

    static async saveUser(params: {
        id: string;
        name?: string;
        avatar?: string;
        connections: UserConnectionSettings;
        username?: string;
        email?: string;
        masterKey: CryptoKey;
        identityKeyPair: CryptoKeyPair;
    }): Promise<UserRecord> {
        const existing = await appUser.getUser(params.id);
        const now = clock.now();

        if (
            existing &&
            resolveServerUrl(existing.connections.server) !==
                resolveServerUrl(params.connections.server)
        ) {
            throw new AppError(
                'INVALID_INPUT',
                'This account belongs to a different server connection.'
            );
        }

        const record: UserRecord = {
            id: params.id,
            name: params.name ?? existing?.name ?? `User ${params.id}`,
            avatar: params.avatar ?? existing?.avatar ?? getDefaultAvatarUrl(params.id),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            masterKey: params.masterKey,
            identityKeyPair: params.identityKeyPair,
            connections: existing?.connections ?? params.connections,
            username: params.username,
            email: params.email
        };

        await appUser.saveUser(record, { origin: 'sync' });
        return record;
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

    static async getActiveConnections(): Promise<UserConnectionSettings> {
        const { userId } = getActiveSession();
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        return user.connections;
    }

    static async updateConnections(
        userId: string,
        connections: UserConnectionSettings
    ): Promise<User> {
        const user = await appUser.getUser(userId);
        if (!user) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        user.connections = connections;
        user.updatedAt = clock.now();
        await appUser.saveUser(user, { origin: 'sync' });
        return toUser(user);
    }

    /**
     * Deletes a local account and all of its associated local data.
     * This prevents orphaned encrypted data from consuming disk space.
     */
    static async deleteUser(userId: string): Promise<void> {
        await appUser.deleteUser(userId, { origin: 'sync' });

        const userScope = { scopeType: 'user' as const, scopeId: userId };
        await AssetService.deleteScopeAssets(userScope);

        await Promise.all(TABLES.map((table) => buffer.flushTable(table)));

        const dbPromises = TABLES.map((table) =>
            localDB.deleteByIndex(table, 'scopeId', userId, { origin: 'sync' })
        );
        const kvPromises = [
            appKV.remove(`lastSync_records_user_${userId}`),
            appKV.remove(`lastSync_assets_user_${userId}`),
            appKV.remove(`lastSync_multi_meta_${userId}`)
        ];

        await Promise.all([
            ...dbPromises,
            ...kvPromises,
            appMulti.purgeUserLocal(userId, { origin: 'sync' })
        ]);

        try {
            const { userId: currentUserId } = getActiveSession();
            if (currentUserId === userId) {
                await this.clearActiveUser();
            }
        } catch (error) {
            // Ignore
        }
    }
}
