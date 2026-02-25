/**
 * Recovery code generation and handling.
 *
 * Recovery code = 16 alphanumeric characters (uppercase + digits, no ambiguous chars).
 *   Front 8 chars → Z (encryption key for M) → M(Z) stored on server
 *   Back 8 chars  → auth token → SHA-256 hashed and stored on server
 *
 * When the user loses their password:
 *   1. Email verification for identity
 *   2. User enters full 16-char recovery code
 *   3. Back 8 → hashed → sent to server for auth
 *   4. Front 8 → derive Z → decrypt M(Z) → recover M
 *   5. New password → new KDF(salt, X, Y) → re-wrap M with new Y
 */

import { RECOVERY_CODE_LENGTH, RECOVERY_FRONT_LENGTH } from './constants.js';
import { wrapMasterKey } from './masterKey.js';
import type { RecoveryCodeParts } from './types.js';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Character set for recovery codes.
 * Excludes ambiguous characters: 0/O, 1/I/L to avoid transcription errors.
 */
const RECOVERY_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generate a random recovery code.
 */
export function generateRecoveryCode(): RecoveryCodeParts {
	const values = crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_LENGTH));
	let code = '';
	for (const byte of values) {
		code += RECOVERY_CHARSET[byte % RECOVERY_CHARSET.length];
	}

	return {
		fullCode: code,
		frontHalf: code.slice(0, RECOVERY_FRONT_LENGTH),
		backHalf: code.slice(RECOVERY_FRONT_LENGTH)
	};
}

/**
 * Split an existing recovery code into its two halves.
 */
export function splitRecoveryCode(code: string): RecoveryCodeParts {
	if (code.length !== RECOVERY_CODE_LENGTH) {
		throw new Error(`Recovery code must be exactly ${RECOVERY_CODE_LENGTH} characters`);
	}
	return {
		fullCode: code,
		frontHalf: code.slice(0, RECOVERY_FRONT_LENGTH),
		backHalf: code.slice(RECOVERY_FRONT_LENGTH)
	};
}

/**
 * Derive a 256-bit AES key (Z) from the front half of the recovery code.
 *
 * Uses PBKDF2 with a fixed domain-separated salt.
 * Lower iteration count is acceptable here because the recovery code
 * has ~39 bits of entropy (log2(30) ≈ 4.9, × 8 chars),
 * and the recovery endpoint is rate-limited on the server.
 */
export async function deriveRecoveryKey(frontHalf: string): Promise<Bytes> {
	const encoder = new TextEncoder();

	const baseKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(frontHalf),
		'PBKDF2',
		false,
		['deriveBits']
	);

	// Use a domain-separated fixed salt for recovery key derivation
	const salt = encoder.encode('kei:recovery-key-derivation');

	const bits = new Uint8Array(
		(await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt,
				iterations: 100_000,
				hash: 'SHA-256'
			},
			baseKey,
			256
		)) as ArrayBuffer
	);

	return bits;
}

/**
 * Hash the back half of the recovery code for server-side auth verification.
 */
export async function hashRecoveryAuthToken(backHalf: string): Promise<Bytes> {
	const encoder = new TextEncoder();
	const hash = new Uint8Array(
		(await crypto.subtle.digest('SHA-256', encoder.encode(backHalf))) as ArrayBuffer
	);
	return hash;
}

/**
 * Create recovery data during registration.
 *
 * @param masterKey - extractable master key M (only extractable during registration)
 * @returns recovery code parts + encrypted M(Z) + hashed auth token
 */
export async function createRecoveryData(masterKey: CryptoKey) {
	const recoveryCode = generateRecoveryCode();

	// Derive Z from front half
	const recoveryKeyZ = await deriveRecoveryKey(recoveryCode.frontHalf);

	// Wrap M with Z → M(Z)
	const { ciphertext, iv } = await wrapMasterKey(masterKey, recoveryKeyZ);

	// Hash back half for server auth
	const authTokenHash = await hashRecoveryAuthToken(recoveryCode.backHalf);

	// Zero out Z
	recoveryKeyZ.fill(0);

	return {
		recoveryCode,
		encryptedRecoveryMasterKey: ciphertext,
		encryptedRecoveryMasterKeyIV: iv,
		recoveryAuthTokenHash: authTokenHash
	};
}

/**
 * Recover master key M using the recovery code.
 *
 * @param fullCode - the 16-character recovery code
 * @param encryptedM - M(Z) from server
 * @param iv - IV used when creating M(Z)
 * @returns non-extractable master key M
 */
export async function recoverMasterKey(
	fullCode: string,
	encryptedM: Bytes,
	iv: Bytes
): Promise<CryptoKey> {
	const { frontHalf } = splitRecoveryCode(fullCode);
	const recoveryKeyZ = await deriveRecoveryKey(frontHalf);

	// Decrypt M(Z)
	const wrappingKey = await crypto.subtle.importKey(
		'raw',
		recoveryKeyZ,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const rawMaster = new Uint8Array(
		(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, encryptedM)) as ArrayBuffer
	);

	// Import as non-extractable
	const masterKey = await crypto.subtle.importKey(
		'raw',
		rawMaster,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);

	rawMaster.fill(0);
	recoveryKeyZ.fill(0);

	return masterKey;
}
