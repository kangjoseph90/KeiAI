/**
 * Master Key management module.
 *
 * The master key M is a random AES-256-GCM key that encrypts all user data
 * (messages, API keys, etc.). It is:
 *   - Generated on registration
 *   - Wrapped (encrypted) with Y before sending to the server → M(Y)
 *   - Never exposed in extractable form outside IndexedDB
 */

import { AES_IV_BYTES, AES_KEY_BITS } from './constants.js';
import { importWrappingKey } from './kdf.js';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Generate a fresh master key M.
 *
 * `extractable: true` is required here ONLY so we can immediately wrap it
 * with Y. After wrapping, the unwrapped version stored in IndexedDB will
 * be non-extractable.
 */
export async function generateMasterKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, true, [
		'encrypt',
		'decrypt'
	]);
}

/**
 * Wrap (encrypt) the master key M using wrapping key material (Y or Z).
 *
 * We export M as raw bytes, then AES-GCM encrypt those bytes with the
 * wrapping key. This avoids SubtleCrypto.wrapKey which has browser
 * compatibility quirks with non-extractable keys.
 *
 * @returns ciphertext and IV
 */
export async function wrapMasterKey(
	masterKey: CryptoKey,
	wrappingKeyBytes: Bytes
): Promise<{ ciphertext: Bytes; iv: Bytes }> {
	const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
	const wrappingKey = await importWrappingKey(wrappingKeyBytes);

	// Export M as raw 32 bytes
	const rawMaster = new Uint8Array(
		(await crypto.subtle.exportKey('raw', masterKey)) as ArrayBuffer
	);

	// Encrypt M with wrapping key
	const ciphertext = new Uint8Array(
		(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawMaster)) as ArrayBuffer
	);

	// Zero out raw master key bytes from memory
	rawMaster.fill(0);

	return { ciphertext, iv };
}

/**
 * Unwrap (decrypt) the master key M from its encrypted form.
 *
 * The resulting CryptoKey is imported as **non-extractable** so that even
 * if an XSS attacker gains access to IndexedDB, they cannot export the
 * raw key bytes via `crypto.subtle.exportKey`.
 *
 * @param ciphertext - encrypted master key bytes M(Y) or M(Z)
 * @param iv - IV used during wrapping
 * @param wrappingKeyBytes - raw key material (Y or Z)
 * @returns non-extractable AES-GCM CryptoKey
 */
export async function unwrapMasterKey(
	ciphertext: Bytes,
	iv: Bytes,
	wrappingKeyBytes: Bytes
): Promise<CryptoKey> {
	const wrappingKey = await importWrappingKey(wrappingKeyBytes);

	// Decrypt to get raw M bytes
	const rawMaster = new Uint8Array(
		(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext)) as ArrayBuffer
	);

	// Import as non-extractable CryptoKey
	const masterKey = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		false, // ← extractable: false — XSS protection
		['encrypt', 'decrypt']
	);

	// Zero out raw bytes
	rawMaster.fill(0);

	return masterKey;
}

/**
 * Unwrap master key and return raw bytes instead of CryptoKey.
 * Used by auth flows that need raw bytes for local DB storage.
 */
export async function unwrapMasterKeyRaw(
	ciphertext: Bytes,
	iv: Bytes,
	wrappingKeyBytes: Bytes
): Promise<Bytes> {
	const wrappingKey = await importWrappingKey(wrappingKeyBytes);
	const rawMaster = new Uint8Array(
		(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext)) as ArrayBuffer
	);
	wrappingKeyBytes.fill(0);
	return rawMaster;
}
