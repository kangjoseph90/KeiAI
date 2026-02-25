/**
 * AES-GCM encryption / decryption for user data.
 *
 * Used to encrypt:
 *   - Chat messages
 *   - BYOK API keys
 *   - Any other sensitive user data
 *
 * Every encryption uses a fresh random IV to ensure semantic security.
 */

import { AES_IV_BYTES } from './constants.js';
import type { EncryptedData } from './types.js';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Encrypt plaintext string with master key M using AES-256-GCM.
 *
 * @param masterKey - non-extractable CryptoKey from IndexedDB
 * @param plaintext - data to encrypt (UTF-8 string)
 * @returns ciphertext + IV (both needed for decryption)
 */
export async function encrypt(masterKey: CryptoKey, plaintext: string): Promise<EncryptedData> {
	const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
	const encoder = new TextEncoder();

	const ciphertext = new Uint8Array(
		(await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			masterKey,
			encoder.encode(plaintext)
		)) as ArrayBuffer
	);

	return { ciphertext, iv };
}

/**
 * Decrypt ciphertext back to plaintext string.
 *
 * AES-GCM will throw if the ciphertext has been tampered with
 * (built-in integrity verification via authentication tag).
 *
 * @param masterKey - same CryptoKey used for encryption
 * @param data - ciphertext + IV
 * @returns original plaintext string
 * @throws DOMException if decryption fails (wrong key or tampered data)
 */
export async function decrypt(masterKey: CryptoKey, data: EncryptedData): Promise<string> {
	const plainBytes = (await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: data.iv },
		masterKey,
		data.ciphertext
	)) as ArrayBuffer;

	return new TextDecoder().decode(plainBytes);
}

/**
 * Encrypt raw bytes (e.g. for wrapping key material that isn't a string).
 */
export async function encryptBytes(masterKey: CryptoKey, data: Bytes): Promise<EncryptedData> {
	const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));

	const ciphertext = new Uint8Array(
		(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, data)) as ArrayBuffer
	);

	return { ciphertext, iv };
}

/**
 * Decrypt back to raw bytes.
 */
export async function decryptBytes(masterKey: CryptoKey, data: EncryptedData): Promise<Bytes> {
	return new Uint8Array(
		(await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: data.iv },
			masterKey,
			data.ciphertext
		)) as ArrayBuffer
	);
}
