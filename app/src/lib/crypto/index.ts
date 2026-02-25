/**
 * Pure Crypto Toolkit — Stateless utility functions only.
 * No session state, no DB access, no localStorage.
 */

export { generateSalt, deriveKeys } from './kdf.js';
export { generateMasterKey, wrapMasterKey, unwrapMasterKey, unwrapMasterKeyRaw } from './masterKey.js';
export { encrypt, decrypt, encryptBytes, decryptBytes } from './encryption.js';
export {
	createRecoveryData,
	splitRecoveryCode,
	hashRecoveryAuthToken,
	deriveRecoveryKey
} from './recovery.js';
export type {
	RegistrationPayload,
	LinkAccountResult,
	LoginBundle,
	RecoveryBundle,
	EncryptedData,
	DerivedKeys,
	RecoveryCodeParts
} from './types.js';

// ─── Encoding Utilities ─────────────────────────────────────────────

type Bytes = Uint8Array<ArrayBuffer>;

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
