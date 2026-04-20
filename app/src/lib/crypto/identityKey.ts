/**
 * Identity Key Pair management module.
 *
 * Each user has an ECDH P-256 key pair that serves as their cryptographic identity.
 * The key pair is used for asymmetric encryption (future: Room Key exchange in multi-room).
 *
 * Key lifecycle:
 *   - Generated on guest creation or first login
 *   - Private key stored locally as a non-extractable CryptoKey (XSS protection)
 *   - Private key uploaded to server wrapped with master key M (AES-GCM)
 *   - Public key uploaded to server as plaintext JWK (intentional — needed for Room Key exchange)
 */

import { ECDH_CURVE } from './constants';

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Key Generation ───────────────────────────────────────────────────

/**
 * Generate a fresh ECDH P-256 identity key pair.
 * Private key is extractable so it can be immediately wrapped with M and uploaded.
 * After upload and local storage, it will be re-imported as non-extractable.
 */
export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']);
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
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: ECDH_CURVE }, true, []);
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
 * @param extractable - false for registered users (XSS protection), true for guests
 */
export async function importPrivateKey(raw: Bytes, extractable: boolean): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'pkcs8',
        raw,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        extractable,
        ['deriveKey']
    );
}

// ─── ECDH Key Agreement ───────────────────────────────────────────────

/**
 * Derive a shared AES-256-GCM secret from our private key and another user's public key.
 *
 * The derived key is non-extractable and suitable for use as a Room Key or
 * as an intermediate to wrap/unwrap a Room Key.
 *
 * Property: deriveSharedSecret(alice.private, bob.public) ===
 *           deriveSharedSecret(bob.private, alice.public)
 *
 * This function is not yet used in production — it is the primitive for
 * future multi-room Room Key exchange.
 */
export async function deriveSharedSecret(
    myPrivateKey: CryptoKey,
    theirPublicKey: CryptoKey
): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPublicKey },
        myPrivateKey,
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt']
    );
}
