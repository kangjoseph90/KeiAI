/**
 * Type definitions for the E2EE + BYOK crypto system.
 *
 * NOTE: We use `Uint8Array<ArrayBuffer>` throughout instead of plain `Uint8Array`
 * to satisfy TypeScript 5.9+ where `BufferSource` requires `ArrayBuffer` (not `ArrayBufferLike`).
 */

/** Convenience alias */
type Bytes = Uint8Array<ArrayBuffer>;

/** Data sent to server during registration */
export interface RegistrationPayload {
	salt: Bytes;
	loginKey: Bytes; // X — server stores this for auth
	encryptedMasterKey: Bytes; // M(Y) — master key encrypted with Y
	encryptedMasterKeyIV: Bytes; // IV used for M(Y)
	encryptedRecoveryMasterKey: Bytes; // M(Z) — master key encrypted with recovery key front half
	encryptedRecoveryMasterKeyIV: Bytes; // IV used for M(Z)
	recoveryAuthTokenHash: Bytes; // SHA-256 hash of recovery key back half
}

/** Data returned from server during login */
export interface LoginBundle {
	salt: Bytes;
	encryptedMasterKey: Bytes; // M(Y)
	encryptedMasterKeyIV: Bytes;
}

/** Data returned from server during recovery */
export interface RecoveryBundle {
	encryptedRecoveryMasterKey: Bytes; // M(Z)
	encryptedRecoveryMasterKeyIV: Bytes;
}

/** Result of encrypting plaintext with AES-GCM */
export interface EncryptedData {
	ciphertext: Bytes;
	iv: Bytes;
}

/** Recovery code split into two halves */
export interface RecoveryCodeParts {
	fullCode: string; // 16 characters, shown to user once
	frontHalf: string; // first 8 chars — used to encrypt M → M(Z)
	backHalf: string; // last 8 chars — hashed for server auth
}

/** Result of the account linking (registration) flow */
export interface LinkAccountResult {
	payload: RegistrationPayload;
	recoveryCode: string; // 16-char code, user must save offline
}

/** KDF output: login key X and encryption key Y */
export interface DerivedKeys {
	loginKey: Bytes; // X (first 256 bits)
	encryptionKey: Bytes; // Y (last 256 bits)
}
