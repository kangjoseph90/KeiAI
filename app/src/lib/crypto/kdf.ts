/**
 * Key Derivation Function (KDF) module.
 *
 * Derives two independent 256-bit keys from a single password:
 *   X (loginKey)      — sent to server for authentication
 *   Y (encryptionKey) — never leaves the client, used to wrap master key M
 *
 * Uses PBKDF2 with SHA-256.
 */

import { KDF_ITERATIONS, KDF_OUTPUT_BITS, SALT_BYTES } from './constants.js';
import type { DerivedKeys } from './types.js';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Generate a cryptographically random salt.
 */
export function generateSalt(): Bytes {
	return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Derive login key X and encryption key Y from password + salt.
 *
 * 1. Import password as a PBKDF2 base key.
 * 2. Derive 512 bits via PBKDF2-HMAC-SHA-256 (600k iterations).
 * 3. Split result: first 256 bits → X, last 256 bits → Y.
 */
export async function deriveKeys(password: string, salt: Bytes): Promise<DerivedKeys> {
	const encoder = new TextEncoder();
	const passwordBytes = encoder.encode(password);

	// Import raw password as PBKDF2 key material
	const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, [
		'deriveBits'
	]);

	// Derive 512 bits
	const derivedBits = new Uint8Array(
		(await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt,
				iterations: KDF_ITERATIONS,
				hash: 'SHA-256'
			},
			baseKey,
			KDF_OUTPUT_BITS
		)) as ArrayBuffer
	);

	const half = derivedBits.length / 2;

	return {
		loginKey: derivedBits.slice(0, half), // X — 32 bytes
		encryptionKey: derivedBits.slice(half) // Y — 32 bytes
	};
}

/**
 * Import raw bytes as an AES-GCM CryptoKey for wrapping/unwrapping the master key.
 *
 * @param rawKey - 32-byte key material (Y or Z)
 * @param extractable - whether the resulting key can be exported (usually false)
 */
export async function importWrappingKey(
	rawKey: Bytes,
	extractable = false
): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, extractable, [
		'encrypt',
		'decrypt'
	]);
}
