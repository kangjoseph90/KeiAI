/**
 * Pure Crypto Toolkit — Stateless utility functions only.
 * No session state, no DB access, no localStorage.
 */

export { generateSalt, deriveKeys } from './kdf';
export {
	generateMasterKey,
	importMasterKey,
	wrapMasterKey,
	unwrapMasterKey,
	unwrapMasterKeyRaw
} from './masterKey';
export { encrypt, decrypt, encryptBytes, decryptBytes } from './encryption';
export {
	createRecoveryData,
	splitRecoveryCode,
	hashRecoveryAuthToken,
	deriveRecoveryKey
} from './recovery';
export type {
	RegistrationPayload,
	LinkAccountResult,
	LoginBundle,
	RecoveryBundle,
	EncryptedData,
	DerivedKeys,
	RecoveryCodeParts,
	Bytes
} from './types';

export { sha256, sha256Bytes } from './hash';
export { toBase64, fromBase64, toHex, fromHex } from './encoding';
