/**
 * Type definitions for the E2EE + BYOK crypto system.
 *
 * NOTE: We use `Uint8Array<ArrayBuffer>` throughout instead of plain `Uint8Array`
 * to satisfy TypeScript 5.9+ where `BufferSource` requires `ArrayBuffer` (not `ArrayBufferLike`).
 */

/** Convenience alias */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Data returned from server during recovery */
export interface RecoveryBundle {
    userId: string;
    encryptedRecoveryMasterKey: Bytes; // M(Z)
    encryptedRecoveryMasterKeyIV: Bytes;
    identityPublicKey: JsonWebKey;
    encryptedIdentityPrivateKey: Bytes;
    identityPrivateKeyIV: Bytes;
}

/** Result of encrypting plaintext with AES-GCM */
export interface EncryptedData {
    ciphertext: Bytes;
    iv: Bytes;
}

/** Recovery code split into two halves */
export interface RecoveryCodeParts {
    fullCode: string; // 24 characters, shown to user once
    frontHalf: string; // first 12 chars — used to encrypt M → M(Z)
    backHalf: string; // last 12 chars — hashed for server auth
}

/** KDF output: login key X and encryption key Y */
export interface DerivedKeys {
    loginKey: Bytes; // X (first 256 bits)
    encryptionKey: Bytes; // Y (last 256 bits)
}
