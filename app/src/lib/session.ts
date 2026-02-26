/**
 * Session State Manager
 *
 * Owns the in-memory master key and active user context.
 * Provides convenience encrypt/decrypt wrappers that services consume.
 *
 * Master key storage strategy:
 *   - Guest:      CryptoKey with extractable: true  (can create M(Y) later)
 *   - Registered: CryptoKey with extractable: false (XSS cannot export raw bytes)
 */

import { generateMasterKey, encrypt, decrypt, type EncryptedData } from './crypto/index.js';
import { localDB, type UserRecord } from './db/index.js';

type Bytes = Uint8Array<ArrayBuffer>;

// ─── In-Memory Session State ─────────────────────────────────────────

let activeMasterKey: CryptoKey | null = null;
let activeUserId: string | null = null;
let isGuestUser: boolean = true;

// ─── Accessors ───────────────────────────────────────────────────────

export function getActiveSession(): { userId: string; masterKey: CryptoKey; isGuest: boolean } {
	if (!activeUserId || !activeMasterKey) {
		throw new Error('Session not initialized. Call initSession() first.');
	}
	return { userId: activeUserId, masterKey: activeMasterKey, isGuest: isGuestUser };
}

export function hasActiveSession(): boolean {
	return activeMasterKey !== null && activeUserId !== null;
}

/**
 * Directly set session state. Used internally by auth flows.
 */
export function setSession(userId: string, masterKey: CryptoKey, isGuest: boolean): void {
	activeUserId = userId;
	activeMasterKey = masterKey;
	isGuestUser = isGuest;
	localStorage.setItem('activeUserId', userId);
}

export function clearSession(): void {
	activeMasterKey = null;
	activeUserId = null;
	isGuestUser = true;
	localStorage.removeItem('activeUserId');
}

// ─── Session Initialization ─────────────────────────────────────────

/**
 * Boot the app session.
 * Restores an existing user from local DB, or creates a new guest.
 */
export async function initSession(): Promise<{ userId: string; masterKey: CryptoKey; isGuest: boolean }> {
	const savedUserId = localStorage.getItem('activeUserId');

	if (savedUserId) {
		const user = await localDB.getRecord<UserRecord>('users', savedUserId);
		if (user && !user.isDeleted) {
			// CryptoKey comes directly from IndexedDB via Structured Clone
			setSession(user.id, user.masterKey, user.isGuest);
			return getActiveSession();
		}
	}

	return await createGuestUser();
}

/**
 * Create a brand new offline guest user with a fresh master key.
 * The key is generated with extractable: true so that when the user
 */
export async function createGuestUser(): Promise<{ userId: string; masterKey: CryptoKey; isGuest: boolean }> {
	const id = crypto.randomUUID();
	const guestKey = await generateMasterKey(); // extractable: true

	await localDB.putRecord('users', {
		id,
		userId: id,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: true,
		masterKey: guestKey
	} as UserRecord);

	setSession(id, guestKey, true);

	return getActiveSession();
}

// ─── Master Key Lifecycle Helpers ────────────────────────────────────

/**
 * Downgrade the local master key to non-extractable.
 * Called after successful registration.
 */
export async function lockMasterKey(userId: string, masterKey: CryptoKey): Promise<void> {
	const rawM = new Uint8Array(
		(await crypto.subtle.exportKey('raw', masterKey)) as ArrayBuffer
	);
	const lockedKey = await crypto.subtle.importKey(
		'raw', rawM, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
	);
	rawM.fill(0);

	const user = await localDB.getRecord<UserRecord>('users', userId);
	if (!user) throw new Error('User not found.');

	user.masterKey = lockedKey;
	user.updatedAt = Date.now();
	await localDB.putRecord('users', user);

	// Update in-memory session with the locked key
	setSession(userId, lockedKey, false);
}

/**
 * Upgrade the local master key back to extractable.
 * Called when unlinking a registered account (reverting to guest state)
 */
export async function unlockMasterKey(userId: string, rawMasterKey: Bytes): Promise<void> {
	const unlockedKey = await crypto.subtle.importKey(
		'raw', rawMasterKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
	);

	const user = await localDB.getRecord<UserRecord>('users', userId);
	if (!user) throw new Error('User not found.');

	user.masterKey = unlockedKey;
	user.isGuest = true;
	user.updatedAt = Date.now();
	await localDB.putRecord('users', user);

	setSession(userId, unlockedKey, true);
}

// ─── Convenience Crypto Wrappers ─────────────────────────────────────

export async function encryptText(masterKey: CryptoKey, plaintext: string): Promise<EncryptedData> {
	return encrypt(masterKey, plaintext);
}

export async function decryptText(masterKey: CryptoKey, data: EncryptedData): Promise<string> {
	return decrypt(masterKey, data);
}

// ─── Internal Helpers ────────────────────────────────────────────────

export async function importMasterKey(raw: Bytes, extractable: boolean): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}
