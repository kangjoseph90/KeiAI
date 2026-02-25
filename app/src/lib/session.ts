/**
 * Session State Manager
 *
 * Owns the in-memory master key and active user context.
 * Provides convenience encrypt/decrypt wrappers that services consume.
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
			const key = await importMasterKey(user.masterKey, false);
			setSession(user.id, key, user.isGuest);
			return getActiveSession();
		}
	}

	return await createGuestUser();
}

/**
 * Create a brand new offline guest user with a fresh master key.
 */
export async function createGuestUser(): Promise<{ userId: string; masterKey: CryptoKey; isGuest: boolean }> {
	const id = crypto.randomUUID();
	const extractableKey = await generateMasterKey();
	const rawKey = new Uint8Array((await crypto.subtle.exportKey('raw', extractableKey)) as ArrayBuffer);

	await localDB.putRecord('users', {
		id,
		userId: id,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: true,
		masterKey: rawKey
	} as UserRecord);

	const memoryKey = await importMasterKey(rawKey, false);
	setSession(id, memoryKey, true);

	return getActiveSession();
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
