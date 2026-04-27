/**
 * User & Key Management Adapter Interface
 *
 * Dedicated storage adapter for managing the `UserRecord` and its underlying `CryptoKey` object.
 * Separated from normal application data so Tauri can keep IndexedDB as the ergonomic primary
 * CryptoKey store while mirroring metadata and raw key backups in more durable native storage.
 */

import type { DatabaseMutationOrigin } from '$lib/adapters/db';

// ─── Write Event Types ────────────────────────────────────────────────

export type UserTableName = 'users';
export type UserWriteOperation = 'put' | 'softDelete';

export interface UserWriteOptions {
    origin?: DatabaseMutationOrigin;
}

export interface UserWriteEvent {
    tableName: UserTableName;
    operation: UserWriteOperation;
    ids: string[];
    origin: DatabaseMutationOrigin;
}

export type UserWriteEventListener = (events: UserWriteEvent[]) => void;

// ─── Adapter Interface ────────────────────────────────────────────────

export interface IUserAdapter {
    /** Subscribe to user-local write events. */
    subscribeWriteEvents(listener: UserWriteEventListener): () => void;

    /** Retrieve a specific user's record. */
    getUser(id: string): Promise<UserRecord | null>;

    /** Retrieve all local users (useful for multi-account / account switching). */
    getAllUsers(): Promise<UserRecord[]>;

    /** Create or update a user record. */
    saveUser(user: UserRecord, options?: UserWriteOptions): Promise<void>;

    /** Soft or hard delete a user from local storage. */
    deleteUser(id: string, options?: UserWriteOptions): Promise<void>;

    /** Backup the user's extractable master key to the OS key store. */
    backupMasterKey(id: string, rawKey: Uint8Array): Promise<void>;

    /** Restore a master key from the OS key store if IndexedDB was cleared. */
    restoreMasterKey(id: string): Promise<Uint8Array | null>;

    /** Backup identity keys to the OS key store. */
    backupIdentityKeys(
        id: string,
        publicKeyJwk: JsonWebKey,
        rawPrivateKey: Uint8Array
    ): Promise<void>;

    /** Restore identity keys from the OS key store if IndexedDB was cleared. */
    restoreIdentityKeys(
        id: string
    ): Promise<{ publicKeyJwk: JsonWebKey; rawPrivateKey: Uint8Array } | null>;
}

/**
 * Because the DB adapter no longer knows about UserRecord, we define it here,
 * or at least we export it from here as it now belongs to the auth domain.
 */
export interface UserRecord {
    id: string; // UUID matching PocketBase ID
    name: string; // Editable display name (e.g., "Local 1", "Main Profile")
    username?: string; // Login alias on the current sync server
    email?: string; // Optional contact email for notices; not used for auth
    avatar: string; // Identicon URL based on user ID
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
    syncServerUrl?: string; // Selected sync server for account operations; not link state
    masterKey: CryptoKey; // The live CryptoKey object
    identityKeyPair: CryptoKeyPair; // ECDH P-256 key pair for asymmetric operations (multi-room)
}
