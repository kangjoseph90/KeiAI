import Dexie from 'dexie';
import type { IUserAdapter, UserRecord } from './types.js';

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
			users: 'id, isDeleted, isGuest, updatedAt' // 'id' is Primary Key, others for indexing
		});
	}
}

const authDB = new UserDexie();

export class WebUserAdapter implements IUserAdapter {
	async getUser(id: string): Promise<UserRecord | null> {
		return (await authDB.users.get(id)) ?? null;
	}

	async getAllUsers(): Promise<UserRecord[]> {
		return await authDB.users.filter((u) => !u.isDeleted).toArray();
	}

	async saveUser(user: UserRecord): Promise<void> {
		await authDB.users.put(user);
	}

	async deleteUser(id: string): Promise<void> {
		const user = await this.getUser(id);
		if (user) {
			user.isDeleted = true;
			user.updatedAt = Date.now();
			await authDB.users.put(user);
		}
	}

	async backupGuestKey(_id: string, _rawKey: Uint8Array): Promise<void> {
		// No-op on the web platform.
		// Web browsers do not have a uniform OS keychain API we can use synchronously.
		return Promise.resolve();
	}

	async restoreGuestKey(_id: string): Promise<Uint8Array | null> {
		// No-op on the web platform.
		return Promise.resolve(null);
	}
}

export const webUser = new WebUserAdapter();
