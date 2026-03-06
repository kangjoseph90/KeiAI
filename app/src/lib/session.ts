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

import { generateMasterKey, encrypt, decrypt, type EncryptedData } from './core/crypto/index.js';
import { appKV } from './adapters/kv/index.js';
import { appUser, type UserRecord } from './adapters/user/index.js';
import { generateId } from './shared/id.js';
import { pb } from './core/api/pb.js';

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
export async function setSession(userId: string, masterKey: CryptoKey, isGuest: boolean): Promise<void> {
	activeUserId = userId;
	activeMasterKey = masterKey;
	isGuestUser = isGuest;
	await appKV.set('activeUserId', userId);
}

export async function clearSession(): Promise<void> {
	activeMasterKey = null;
	activeUserId = null;
	isGuestUser = true;
	await appKV.remove('activeUserId');
}

// ─── Session Initialization ─────────────────────────────────────────

/**
 * Boot the app session.
 * Restores an existing user from local DB, or creates a new guest.
 */
export async function initSession(): Promise<{
	userId: string;
	masterKey: CryptoKey;
	isGuest: boolean;
}> {
	const savedUserId = await appKV.get('activeUserId');

	if (savedUserId) {
		const user = await appUser.getUser(savedUserId);
		if (user && !user.isDeleted) {
			// CryptoKey comes directly from IndexedDB via Structured Clone
			await setSession(user.id, user.masterKey, user.isGuest);
			return getActiveSession();
		}
	}

	// IndexedDB was cleared (cache eviction, browser storage pressure, etc.).
	// If PocketBase still holds a valid JWT from a previous session, the auth
	// state would be inconsistent: the UI would show "logged in" but the in-memory
	// session would be a new guest with no data and sync would never run
	// (SyncService bails early when isGuest: true).
	// Drop the stale token so the user sees a clean guest state and the login
	// screen prompts them to re-authenticate and restore their master key.
	if (pb.authStore.isValid) {
		pb.authStore.clear();
	}

	return await createGuestUser();
}

/**
 * Create a brand new offline guest user with a fresh master key.
 * The key is generated with extractable: true so that when the user
 * registers, the raw bytes can be exported, wrapped with the
 * password-derived key Y, and uploaded to the server.
 */
export async function createGuestUser(): Promise<{
	userId: string;
	masterKey: CryptoKey;
	isGuest: boolean;
}> {
	const id = generateId();
	const guestKey = await generateMasterKey(); // extractable: true

	await appUser.saveUser({
		id,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: true,
		masterKey: guestKey
	});

	await setSession(id, guestKey, true);

	return getActiveSession();
}

// ─── Master Key Lifecycle Helpers ────────────────────────────────────

/**
 * Upgrade the local master key back to extractable.
 * Called when unlinking a registered account (reverting to guest state)
 */
export async function unlockMasterKey(userId: string, rawMasterKey: Bytes): Promise<void> {
	const unlockedKey = await crypto.subtle.importKey(
		'raw',
		rawMasterKey,
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt']
	);

	const user = await appUser.getUser(userId);
	if (!user) throw new Error('User not found.');

	user.masterKey = unlockedKey;
	user.isGuest = true;
	user.updatedAt = Date.now();
	await appUser.saveUser(user);

	await setSession(userId, unlockedKey, true);
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
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, [
		'encrypt',
		'decrypt'
	]);
}
