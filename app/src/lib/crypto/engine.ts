/**
 * E2EE + BYOK Crypto Engine — Facade
 *
 * Orchestrates the complete client-side security lifecycle:
 *   Offline Init → Data Encryption → Sync/Link Account → Login/Merge → Recovery
 *
 * Security invariants:
 *   - Server never sees: password, Y, Z, M, or any plaintext data.
 *   - M in memory is non-extractable (XSS cannot export raw bytes).
 *   - Every AES-GCM operation uses a fresh random IV.
 */

import { generateSalt, deriveKeys } from './kdf.js';
import { generateMasterKey, wrapMasterKey } from './masterKey.js';
import { encrypt, decrypt, encryptBytes, decryptBytes } from './encryption.js';
import {
	createRecoveryData,
	splitRecoveryCode,
	hashRecoveryAuthToken,
	deriveRecoveryKey
} from './recovery.js';
import type {
	RegistrationPayload,
	LinkAccountResult,
	LoginBundle,
	RecoveryBundle,
	EncryptedData,
	DerivedKeys,
	RecoveryCodeParts
} from './types.js';
import { localDB, type UserRecord } from '../db/index.js';

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Session State (In-Memory) ───────────────────────────────────────

let activeMasterKey: CryptoKey | null = null;
let activeUserId: string | null = null;
let isGuestUser: boolean = true;

/**
 * Returns the currently active userId and masterKey.
 * Throws an error if session is not initialized.
 */
export function getActiveSession(): { userId: string; masterKey: CryptoKey; isGuest: boolean } {
	if (!activeUserId || !activeMasterKey) {
		throw new Error('E2EE Session is not initialized. Call initSession() first.');
	}
	return { userId: activeUserId, masterKey: activeMasterKey, isGuest: isGuestUser };
}

// ─── App Boot / Session Initialization ──────────────────────────────

/**
 * Initialize the offline-first session.
 * 1. Checks localStorage for an existing active user.
 * 2. If it exists, loads the user record and master key from localDB.
 * 3. If missing, automatically generates a new Guest User and Master Key.
 * @returns Details about the initialized session.
 */
export async function initSession(): Promise<{ userId: string; masterKey: CryptoKey; isGuest: boolean }> {
	const savedUserId = localStorage.getItem('activeUserId');

	if (savedUserId) {
		const user = await localDB.getRecord<UserRecord>('users', savedUserId);
		if (user && !user.isDeleted) {
			activeMasterKey = await crypto.subtle.importKey(
				'raw',
				user.masterKey,
				{ name: 'AES-GCM' },
				false, // Non-extractable in memory
				['encrypt', 'decrypt']
			);
			activeUserId = user.id;
			isGuestUser = user.isGuest;
			return { userId: user.id, masterKey: activeMasterKey, isGuest: isGuestUser };
		}
	}

	// Fallback/First Boot: Create a new offline guest session
	return await createGuestUser();
}

/**
 * Creates a brand new Guest User with a fresh offline Master Key.
 */
export async function createGuestUser(): Promise<{ userId: string; masterKey: CryptoKey; isGuest: boolean }> {
	const newUserId = crypto.randomUUID();

	// Generate extractable master key temporarily to get raw bytes
	const newKey = await generateMasterKey();
	const rawMaster = new Uint8Array((await crypto.subtle.exportKey('raw', newKey)) as ArrayBuffer);

	const userRecord: UserRecord = {
		id: newUserId,
		userId: newUserId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: true,
		masterKey: rawMaster // Store in DB (Until OS secure storage integration)
	};

	await localDB.putRecord('users', userRecord);
	localStorage.setItem('activeUserId', newUserId);

	// Import non-extractable master key into memory
	activeMasterKey = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);
	activeUserId = newUserId;
	isGuestUser = true;

	return { userId: newUserId, masterKey: activeMasterKey, isGuest: true };
}

/**
 * Check whether a crypto session exists actively in memory.
 */
export function hasActiveSession(): boolean {
	return activeMasterKey !== null && activeUserId !== null;
}

/**
 * Logout: clear memory and active user marker.
 */
export function logout(): void {
	activeMasterKey = null;
	activeUserId = null;
	isGuestUser = true;
	localStorage.removeItem('activeUserId');
}

// ─── Registration / Linking (Guest -> Registered) ───────────────────

/**
 * Link an existing offline Guest account to the server.
 * Uses the locally stored Master Key to generate encrypted payloads and recovery code.
 *
 * @param password - user's chosen password
 * @returns account linking payload for server + offline recovery code
 */
export async function linkAccount(password: string): Promise<LinkAccountResult> {
	if (!activeUserId) throw new Error('No active session. Call initSession() first.');

	const user = await localDB.getRecord<UserRecord>('users', activeUserId);
	if (!user || user.isDeleted) throw new Error('Active user record not found in local DB.');

	// 1: Random salt + derive X and Y
	const salt = generateSalt();
	const { loginKey, encryptionKey } = await deriveKeys(password, salt);

	// 2: Get raw master key from local DB, import temporarily as extractable for wrapping
	const rawMaster = user.masterKey;
	const masterKeyExtractable = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt']
	);

	// 3: Wrap M with Y → M(Y)
	const { ciphertext: encryptedMasterKey, iv: encryptedMasterKeyIV } = await wrapMasterKey(
		masterKeyExtractable,
		encryptionKey
	);

	// 4: Recovery code + M(Z) + hashed auth token
	const recovery = await createRecoveryData(masterKeyExtractable);

	// Zero out encryption key
	encryptionKey.fill(0);

	// Mark user record as non-guest (registered status should be finalizing externally upon server response)
	user.isGuest = false;
	user.updatedAt = Date.now();
	await localDB.putRecord('users', user);
	isGuestUser = false;

	return {
		payload: {
			salt,
			loginKey,
			encryptedMasterKey,
			encryptedMasterKeyIV,
			encryptedRecoveryMasterKey: recovery.encryptedRecoveryMasterKey,
			encryptedRecoveryMasterKeyIV: recovery.encryptedRecoveryMasterKeyIV,
			recoveryAuthTokenHash: recovery.recoveryAuthTokenHash
		},
		recoveryCode: recovery.recoveryCode.fullCode
	};
}

// ─── Login & Merge (Registered existing user on new device) ─────────

export async function prepareLogin(
	password: string,
	salt: Bytes
): Promise<{ loginKey: Bytes; encryptionKey: Bytes }> {
	return await deriveKeys(password, salt);
}

/**
 * Processes a successful login on a NEW device.
 * Decrypts the server's master key M(Y), stores it locally, and updates active session.
 * NOTE: The "data merge / re-encryption" logic (migrating existing guest records 
 * encrypted with guest M over to the new server M) should be called immediately after this!
 *
 * @param bundle - encrypted master key data from server
 * @param serverUserId - official PocketBase user UUID
 * @param encryptionKey - Y (from prepareLogin, held in memory)
 * @returns The newly migrated non-extractable server master key M
 */
export async function loginAndMergeSession(
	bundle: LoginBundle,
	serverUserId: string,
	encryptionKey: Bytes
): Promise<CryptoKey> {
	if (!activeUserId || !activeMasterKey) {
		throw new Error('No active guest session found.');
	}

	const guestUserId = activeUserId;

	// 1. Decrypt server's M(Y) with Y to obtain Server's Master Key (M_server)
	const wrappingKey = await crypto.subtle.importKey(
		'raw',
		encryptionKey,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const rawServerMaster = new Uint8Array(
		(await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bundle.encryptedMasterKeyIV },
			wrappingKey,
			bundle.encryptedMasterKey
		)) as ArrayBuffer
	);

	// 2. Import Server M as BOTH extractable (for DB storage) and non-extractable (for memory)
	const serverMasterKey = await crypto.subtle.importKey(
		'raw',
		rawServerMaster,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);

	// ---
	// TODO: Iterate all collections where (userId === guestUserId) 
	// Decrypt with activeMasterKey -> re-encrypt with serverMasterKey!
	// ---

	// 3. Update session config
	activeMasterKey = serverMasterKey;
	activeUserId = serverUserId;
	isGuestUser = false;

	// 4. Create the formal user record locally
	const newLocalUser: UserRecord = {
		id: serverUserId,
		userId: serverUserId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: false,
		masterKey: new Uint8Array(rawServerMaster)
	};
	await localDB.putRecord('users', newLocalUser);

	// Optional: Delete the guest token (or mark them merged)
	if (serverUserId !== guestUserId) {
		await localDB.softDeleteRecord('users', guestUserId);
	}

	localStorage.setItem('activeUserId', serverUserId);

	rawServerMaster.fill(0);
	encryptionKey.fill(0);

	return serverMasterKey;
}

// ─── Data Encryption (Messages, API Keys) ───────────────────────────

export async function encryptText(
	masterKey: CryptoKey,
	plaintext: string
): Promise<EncryptedData> {
	return encrypt(masterKey, plaintext);
}

export async function decryptText(
	masterKey: CryptoKey,
	data: EncryptedData
): Promise<string> {
	return decrypt(masterKey, data);
}

export async function encryptApiKey(
	masterKey: CryptoKey,
	apiKey: string
): Promise<EncryptedData> {
	return encrypt(masterKey, apiKey);
}

export async function decryptApiKey(
	masterKey: CryptoKey,
	data: EncryptedData
): Promise<string> {
	return decrypt(masterKey, data);
}

// ─── Account Operations (Recovery / Change Password) ────────────────

export async function changePassword(
	oldPassword: string,
	oldSalt: Bytes,
	oldBundle: LoginBundle,
	newPassword: string
): Promise<{
	salt: Bytes;
	loginKey: Bytes;
	encryptedMasterKey: Bytes;
	encryptedMasterKeyIV: Bytes;
}> {
	if (!activeUserId) throw new Error('No active session.');
	const user = await localDB.getRecord<UserRecord>('users', activeUserId);
	if (!user) throw new Error('Active user not found in local DB.');

	// 1: Derive old Y and new keys
	const oldKeys = await deriveKeys(oldPassword, oldSalt);
	const newSalt = generateSalt();
	const newKeys = await deriveKeys(newPassword, newSalt);

	// 2: Master key is already present in DB as plaintext bytes
	const rawMaster = user.masterKey;
	
	const masterKeyExtractable = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt']
	);

	oldKeys.encryptionKey.fill(0);

	// 3: Wrap M with new Y
	const { ciphertext, iv } = await wrapMasterKey(masterKeyExtractable, newKeys.encryptionKey);

	newKeys.encryptionKey.fill(0);

	return {
		salt: newSalt,
		loginKey: newKeys.loginKey,
		encryptedMasterKey: ciphertext,
		encryptedMasterKeyIV: iv
	};
}

export async function recoverAccount(
	recoveryCode: string,
	recoveryBundle: RecoveryBundle,
	newPassword: string
): Promise<{
	recoveryAuthTokenHash: Bytes;
	payload: {
		salt: Bytes;
		loginKey: Bytes;
		encryptedMasterKey: Bytes;
		encryptedMasterKeyIV: Bytes;
		encryptedRecoveryMasterKey: Bytes;
		encryptedRecoveryMasterKeyIV: Bytes;
		recoveryAuthTokenHash: Bytes;
	};
	newRecoveryCode: string;
	masterKey: CryptoKey;
	userId: string;
}> {
	const { frontHalf, backHalf } = splitRecoveryCode(recoveryCode);

	// 1: Verify token hash
	const recoveryAuthTokenHash = await hashRecoveryAuthToken(backHalf);

	// 2: Recover M from M(Z)
	const recoveryKeyZ = await deriveRecoveryKey(frontHalf);
	const wrappingKey = await crypto.subtle.importKey(
		'raw',
		recoveryKeyZ,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const rawMaster = new Uint8Array(
		(await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: recoveryBundle.encryptedRecoveryMasterKeyIV },
			wrappingKey,
			recoveryBundle.encryptedRecoveryMasterKey
		)) as ArrayBuffer
	);
	recoveryKeyZ.fill(0);

	const masterKeyExtractable = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt']
	);

	// 3: New credentials
	const newSalt = generateSalt();
	const newKeys = await deriveKeys(newPassword, newSalt);

	const { ciphertext, iv } = await wrapMasterKey(masterKeyExtractable, newKeys.encryptionKey);
	const newRecovery = await createRecoveryData(masterKeyExtractable);

	const masterKey = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);
	
	// Create a formal recovered session locally
	const recoveredUserId = crypto.randomUUID(); // PB ID should ideally be fetched here instead
	activeMasterKey = masterKey;
	activeUserId = recoveredUserId;
	isGuestUser = false;

	const newLocalUser: UserRecord = {
		id: recoveredUserId,
		userId: recoveredUserId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDeleted: false,
		isGuest: false,
		masterKey: new Uint8Array(rawMaster)
	};
	await localDB.putRecord('users', newLocalUser);
	localStorage.setItem('activeUserId', recoveredUserId);

	rawMaster.fill(0);
	newKeys.encryptionKey.fill(0);

	return {
		recoveryAuthTokenHash,
		payload: {
			salt: newSalt,
			loginKey: newKeys.loginKey,
			encryptedMasterKey: ciphertext,
			encryptedMasterKeyIV: iv,
			encryptedRecoveryMasterKey: newRecovery.encryptedRecoveryMasterKey,
			encryptedRecoveryMasterKeyIV: newRecovery.encryptedRecoveryMasterKeyIV,
			recoveryAuthTokenHash: newRecovery.recoveryAuthTokenHash
		},
		newRecoveryCode: newRecovery.recoveryCode.fullCode,
		masterKey,
		userId: recoveredUserId
	};
}

// ─── Utility / Encoding ─────────────────────────────────────────────

export function toBase64(bytes: Bytes): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

export function fromBase64(base64: string): Bytes {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export { encryptBytes, decryptBytes } from './encryption.js';
export type {
	RegistrationPayload,
	LinkAccountResult,
	LoginBundle,
	RecoveryBundle,
	EncryptedData,
	DerivedKeys,
	RecoveryCodeParts
} from './types.js';
