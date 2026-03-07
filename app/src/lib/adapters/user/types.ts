/**
 * User & Key Management Adapter Interface
 *
 * Dedicated storage adapter for managing the `UserRecord` and its underlying `CryptoKey` object.
 * Separated from normal application data to allow storing the `extractable: false` CryptoKeys
 * in IndexedDB even on Tauri, while the rest of the application data goes to SQLite.
 */

export interface IUserAdapter {
	/** Retrieve a specific user's record. */
	getUser(id: string): Promise<UserRecord | null>;

	/** Retrieve all local users (useful for multi-account / account switching). */
	getAllUsers(): Promise<UserRecord[]>;

	/** Create or update a user record. */
	saveUser(user: UserRecord): Promise<void>;

	/** Soft or hard delete a user from local storage. */
	deleteUser(id: string): Promise<void>;

	/**
	 * Backup the guest's extractable CryptoKey to the OS Keychain.
	 * (Only applicable to Guest keys. Registered keys are non-extractable and cannot be backed up locally).
	 */
	backupGuestKey(id: string, rawKey: Uint8Array): Promise<void>;

	/**
	 * Restore a guest key from the OS Keychain if IndexedDB was cleared.
	 */
	restoreGuestKey(id: string): Promise<Uint8Array | null>;
}

/**
 * Because the DB adapter no longer knows about UserRecord, we define it here,
 * or at least we export it from here as it now belongs to the auth domain.
 */
export interface UserRecord {
	id: string; // UUID matching PocketBase ID (or local UUID for guests)
	name: string; // Editable display name (e.g., "Guest 1", "Main Profile")
	email?: string; // Cached email if synced with PocketBase
	avatar: string; // Identicon URL based on user ID
	createdAt: number;
	updatedAt: number;
	isDeleted: boolean;
	isGuest: boolean;
	masterKey: CryptoKey; // The live CryptoKey object
}
