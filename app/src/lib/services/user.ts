/** Local user persistence, boot selection, and session activation. */

import { appUser, type UserRecord } from '$lib/adapters/user';
export type { UserRecord };
import { getActiveSession, setUserSession } from './session';
export type { MultiRoomSession, Session, UserSession } from './session';
import { localDB, TABLES } from '$lib/adapters/db';
import { appMulti } from '$lib/adapters/multi';
import { appKV } from '$lib/adapters/kv';
import { syncCursorDB } from '$lib/adapters/sync';
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
import { applyUserConnectionRuntime, resolveServerUrl } from './connection/runtime';

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

const PENDING_INITIALIZATION_KEY = 'pendingInitializationUserId';
const ACTIVE_USER_KEY = 'activeUserId';

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
    private static async activateUser(stored: UserRecord): Promise<UserRecord> {
        const user: UserRecord = { ...stored, ...parseFields(stored) };
        if (!user.identityKeyPair) {
            user.identityKeyPair = await generateIdentityKeyPair();
            user.updatedAt = clock.now();
            await appUser.saveUser(user);
        }
        setUserSession({
            userId: user.id,
            masterKey: user.masterKey,
            identityKeyPair: user.identityKeyPair
        });
        await appKV.set(ACTIVE_USER_KEY, user.id);
        applyUserConnectionRuntime(user.connections);
        return user;
    }

    static async selectUser(userId: string): Promise<void> {
        await appKV.set(ACTIVE_USER_KEY, userId);
    }

    static async isUserSwitchPending(): Promise<boolean> {
        return (await appKV.get(ACTIVE_USER_KEY)) !== getActiveSession().userId;
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
     * Restore the active user, fall back to an existing user, or create the first user.
     * This is the app's boot entry point, called once from App.svelte.
     */
    static async restoreOrCreateUser(): Promise<{
        user: UserRecord;
        needsInitialization: boolean;
    }> {
        const savedUserId = await appKV.get(ACTIVE_USER_KEY);
        let user = savedUserId ? await appUser.getUser(savedUserId) : null;

        if (!user) {
            const users = await appUser.getAllUsers();
            user = users[0] ?? null;
        }
        if (!user) {
            user = await this.createUser();
        }

        user = await this.activateUser(user);
        return {
            user,
            needsInitialization: (await appKV.get(PENDING_INITIALIZATION_KEY)) === user.id
        };
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

        await appKV.set(PENDING_INITIALIZATION_KEY, id);
        await appUser.saveUser(user);
        return user;
    }

    static async finishInitialization(): Promise<void> {
        await buffer.flushAll();
        await appKV.remove(PENDING_INITIALIZATION_KEY);
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

        await Promise.all([
            ...dbPromises,
            syncCursorDB.deleteByUser(userId),
            appMulti.purgeUserLocal(userId, { origin: 'sync' })
        ]);
        await purgeOrphanScopes();
    }
}
