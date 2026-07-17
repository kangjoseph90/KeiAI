import Dexie from 'dexie';
import { UserWriteEventEmitter } from './events';
import type {
    IUserAdapter,
    UserRecord,
    UserWriteOptions,
    UserWriteEventListener,
    UserWriteOperation
} from './types';

/**
 * Web User Adapter using Dexie.
 * We spin up a separate mini-Dexie database exclusively for the `users` table
 * so that the main `localDB` can be freely swapped to SQLite on Tauri.
 */

class UserDexie extends Dexie {
    users!: Dexie.Table<UserRecord, string>;

    constructor() {
        super('KeiUsers'); // Separate IndexedDB database just for auth
        this.version(1).stores({
            users: 'id, username, updatedAt' // 'id' is Primary Key, others for indexing
        });
    }
}

export const authDB = new UserDexie();

export class WebUserAdapter implements IUserAdapter {
    private readonly writeEvents = new UserWriteEventEmitter();

    subscribeWriteEvents(listener: UserWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    private emitWriteEvent(
        operation: UserWriteOperation,
        ids: string[],
        options?: UserWriteOptions
    ): void {
        this.writeEvents.emit({
            tableName: 'users',
            operation,
            ids,
            origin: options?.origin ?? 'local'
        });
    }

    async getUser(id: string): Promise<UserRecord | null> {
        return (await authDB.users.get(id)) ?? null;
    }

    async getAllUsers(): Promise<UserRecord[]> {
        return await authDB.users.toArray();
    }

    async saveUser(user: UserRecord, options?: UserWriteOptions): Promise<void> {
        await authDB.users.put(user);
        this.emitWriteEvent('put', [user.id], options);
    }

    async deleteUser(id: string, options?: UserWriteOptions): Promise<void> {
        await authDB.users.delete(id);
        this.emitWriteEvent('purge', [id], options);
    }

    async backupMasterKey(_id: string, _rawKey: Uint8Array): Promise<void> {
        // No-op for web. Key recovery relies on the server and password.
    }

    async backupIdentityKeys(
        _id: string,
        _publicKeyJwk: JsonWebKey,
        _rawPrivateKey: Uint8Array
    ): Promise<void> {
        // No-op for web.
    }

    async restoreMasterKey(_id: string): Promise<Uint8Array | null> {
        // No-op on the web platform.
        return Promise.resolve(null);
    }

    async restoreIdentityKeys(
        _id: string
    ): Promise<{ publicKeyJwk: JsonWebKey; rawPrivateKey: Uint8Array } | null> {
        // No-op on the web platform.
        return Promise.resolve(null);
    }
}

export const webUser = new WebUserAdapter();
