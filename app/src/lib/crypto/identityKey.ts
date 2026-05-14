/**
 * Identity Key Pair management module.
 *
 * Each user has an RSA-OAEP key pair that serves as their cryptographic identity.
 * The key pair is used to wrap Room Keys for multi-room membership.
 *
 * Key lifecycle:
 *   - Generated with the local identity on first app launch
 *   - Private key stored locally as an extractable CryptoKey
 *   - Private key uploaded to server wrapped with master key M (AES-GCM)
 *   - Public key uploaded to server as plaintext JWK (intentional — needed for Room Key exchange)
 */

import { IDENTITY_RSA_MODULUS_BITS, IDENTITY_RSA_PUBLIC_EXPONENT } from './constants';
import { importMasterKey } from './masterKey';

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Key Generation ───────────────────────────────────────────────────

/**
 * Generate a fresh RSA-OAEP identity key pair.
 * Private key is extractable so it can be immediately wrapped with M and uploaded.
 * It remains extractable in the current local identity model.
 */
export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: IDENTITY_RSA_MODULUS_BITS,
            publicExponent: IDENTITY_RSA_PUBLIC_EXPONENT,
            hash: 'SHA-256'
        },
        true,
        ['encrypt', 'decrypt']
    );
}

// ─── Public Key Export / Import ──────────────────────────────────────

/**
 * Export a public key as JWK for server storage.
 * Public keys are intentionally stored in plaintext — other users need to
 * read them to encrypt Room Keys for this user.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<JsonWebKey> {
    return crypto.subtle.exportKey('jwk', publicKey);
}

/**
 * Import a JWK public key received from the server.
 * Public keys are always extractable.
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, [
        'encrypt'
    ]);
}

// ─── Private Key Export / Import ─────────────────────────────────────

/**
 * Export a private key as raw PKCS#8 bytes for wrapping with master key M.
 * Only call this on extractable keys (e.g. freshly generated).
 */
export async function exportPrivateKey(privateKey: CryptoKey): Promise<Bytes> {
    return new Uint8Array((await crypto.subtle.exportKey('pkcs8', privateKey)) as ArrayBuffer);
}

/**
 * Import PKCS#8 private key bytes back into a CryptoKey.
 *
 * @param raw - PKCS#8 bytes (decrypted from server's wrapped private key)
 * @param extractable - whether the imported key can be exported again
 */
export async function importPrivateKey(raw: Bytes, extractable: boolean): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'pkcs8',
        raw,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        extractable,
        ['decrypt']
    );
}

// ─── Identity-Based Encryption / Key Wrapping ────────────────────────

/**
 * Encrypt bytes for another identity key.
 *
 * RSA-OAEP can encrypt small payloads directly with the recipient's public key.
 * For larger data, wrap an AES-GCM key and encrypt the data with that key.
 */
export async function encryptForIdentity(
    recipientPublicKey: CryptoKey,
    data: Bytes
): Promise<Bytes> {
    const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, data);
    return new Uint8Array(ciphertext as ArrayBuffer);
}

/**
 * Decrypt bytes encrypted with encryptForIdentity().
 */
export async function decryptWithIdentity(
    recipientPrivateKey: CryptoKey,
    ciphertext: Bytes
): Promise<Bytes> {
    const plaintext = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        recipientPrivateKey,
        ciphertext
    );
    return new Uint8Array(plaintext as ArrayBuffer);
}

/**
 * Export and wrap an AES-GCM key for another identity key.
 *
 * The key being wrapped must be extractable. This is suitable for room keys,
 * which need to be shared with invited members.
 */
export async function wrapKeyForIdentity(
    recipientPublicKey: CryptoKey,
    key: CryptoKey
): Promise<Bytes> {
    const rawKey = new Uint8Array((await crypto.subtle.exportKey('raw', key)) as ArrayBuffer);

    try {
        return await encryptForIdentity(recipientPublicKey, rawKey);
    } finally {
        rawKey.fill(0);
    }
}

/**
 * Unwrap an AES-GCM key shared by another identity.
 */
export async function unwrapKeyWithIdentity(
    recipientPrivateKey: CryptoKey,
    ciphertext: Bytes,
    extractable = true
): Promise<CryptoKey> {
    const rawKey = await decryptWithIdentity(recipientPrivateKey, ciphertext);

    try {
        return await importMasterKey(rawKey, extractable);
    } finally {
        rawKey.fill(0);
    }
}
