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
import { clearSession, getActiveSession, hasActiveSession, setUserSession } from './session';
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
import { buffer } from './content/record_buffer';
import { AssetService } from './asset';
import { purgeOrphanScopes } from './purge';
import type { UserConnectionSettings } from '$lib/types/connections';
import {
    applyUserConnectionRuntime,
    resetConnectionRuntime,
    resolveServerUrl
} from './connection/runtime';

export interface UserFields {
    name: string;
    avatar: string;
    connections: UserConnectionSettings;
    username?: string;
    email?: string;
}

export interface User extends UserFields {
    id: string;
}

const defaultFields: UserFields = {
    name: '',
    avatar: '',
    connections: {
        server: { mode: 'default' },
        proxy: { mode: 'default' }
    }
};

function getDefaultAvatarUrl(seed: string): string {
    const svg = minidenticon(seed);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function toUser(user: UserRecord): User {
    return {
        ...parseFields(user),
        id: user.id
    };
}

function parseFields(record: UserRecord): UserFields {
    const fields = deepMerge(defaultFields, record as DeepPartial<UserFields>);
    return {
        name: fields.name,
        avatar: fields.avatar,
        connections: fields.connections,
        ...(fields.username === undefined ? {} : { username: fields.username }),
        ...(fields.email === undefined ? {} : { email: fields.email })
    };
}

export class UserService {
    /**
     * Persist the active user ID and activate the in-memory session.
     * Pass an empty string to clear the KV (e.g. before page reload for new user creation).
     */
    static async setActiveUser(userId: string): Promise<void> {
        if (!userId) return this.clearActiveUser();
        const stored = await appUser.getUser(userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        const fields = parseFields(stored);
        setUserSession({
            userId,
            masterKey: stored.masterKey,
            identityKeyPair: stored.identityKeyPair
        });
        await appKV.set('activeUserId', userId);
        applyUserConnectionRuntime(fields.connections);
    }

    static async clearActiveUser(): Promise<void> {
        clearSession();
        await appKV.set('activeUserId', '');
        resetConnectionRuntime();
    }

    /** Get a user view by local user ID. */
    static async getUser(userId: string): Promise<User> {
        const stored = await appUser.getUser(userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        return toUser(stored);
    }

    /**
     * Returns all local user records.
     */
    static async getAllUsers(): Promise<User[]> {
        const users = await appUser.getAllUsers();
        return users.map(toUser);
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
            const stored = await appUser.getUser(savedUserId);
            if (stored) {
                const user: UserRecord = {
                    ...parseFields(stored),
                    id: stored.id,
                    createdAt: stored.createdAt,
                    updatedAt: stored.updatedAt,
                    masterKey: stored.masterKey,
                    identityKeyPair: stored.identityKeyPair
                };

                // Backfill identity key pair if the record predates this feature
                if (!user.identityKeyPair) {
                    user.identityKeyPair = await generateIdentityKeyPair();
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
            connections: structuredClone(defaultFields.connections)
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
        const stored = await appUser.getUser(params.id);
        const existing = stored ? parseFields(stored) : null;
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
            createdAt: stored?.createdAt ?? now,
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
        const stored = await appUser.getUser(userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        const fields = deepMerge(parseFields(stored), changes);
        const updated: UserRecord = {
            ...fields,
            id: stored.id,
            createdAt: stored.createdAt,
            masterKey: stored.masterKey,
            identityKeyPair: stored.identityKeyPair,
            updatedAt: clock.now()
        };

        await appUser.saveUser(updated);
        return toUser(updated);
    }

    static async getActiveConnections(): Promise<UserConnectionSettings> {
        const { userId } = getActiveSession();
        const stored = await appUser.getUser(userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        return parseFields(stored).connections;
    }

    static async updateConnections(
        userId: string,
        connections: UserConnectionSettings
    ): Promise<User> {
        const stored = await appUser.getUser(userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `User not found: ${userId}`);
        }
        const updated: UserRecord = {
            ...parseFields(stored),
            connections,
            id: stored.id,
            createdAt: stored.createdAt,
            masterKey: stored.masterKey,
            identityKeyPair: stored.identityKeyPair,
            updatedAt: clock.now()
        };
        await appUser.saveUser(updated, { origin: 'sync' });
        return toUser(updated);
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
            localDB.deleteByScope(table, userScope, { origin: 'sync' })
        );

        const cursorKeys = await appKV.keys('lastSync_');
        const userCursorKeys = cursorKeys.filter((key) => key.includes(`_${userId}_`));
        const cursorDeletes = userCursorKeys.map((key) => appKV.remove(key));

        await Promise.all([
            ...dbPromises,
            ...cursorDeletes,
            appMulti.purgeUserLocal(userId, { origin: 'sync' })
        ]);
        await purgeOrphanScopes();

        if (hasActiveSession()) {
            const { userId: currentUserId } = getActiveSession();
            if (currentUserId === userId) {
                await this.clearActiveUser();
            }
        }
    }
}
