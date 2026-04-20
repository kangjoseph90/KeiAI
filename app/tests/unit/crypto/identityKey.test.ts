/**
 * Crypto Module Tests: identityKey.ts
 *
 * Tests ECDH P-256 identity key pair generation, export/import, and shared secret derivation.
 * Uses real Web Crypto API (no mocking) as required for crypto tests.
 */

import { describe, it, expect } from 'vitest';
import {
    generateIdentityKeyPair,
    exportPublicKey,
    importPublicKey,
    exportPrivateKey,
    importPrivateKey,
    deriveSharedSecret
} from '$lib/crypto/identityKey';
import { generateMasterKey } from '$lib/crypto/masterKey';
import { encrypt, decrypt } from '$lib/crypto/encryption';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Generate a fresh key pair for tests (private key extractable). */
async function makeKeyPair(): Promise<CryptoKeyPair> {
    return generateIdentityKeyPair();
}

describe('identityKey', () => {
    describe('generateIdentityKeyPair', () => {
        it('should generate an ECDH P-256 key pair', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey).toBeInstanceOf(CryptoKey);
            expect(kp.privateKey).toBeInstanceOf(CryptoKey);
            expect(kp.publicKey.algorithm.name).toBe('ECDH');
            expect(kp.privateKey.algorithm.name).toBe('ECDH');
        });

        it('should have correct key types', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey.type).toBe('public');
            expect(kp.privateKey.type).toBe('private');
        });

        it('should have correct usages', async () => {
            const kp = await makeKeyPair();

            // Public key has no usages (only used as ECDH "public" param)
            expect(kp.publicKey.usages).toEqual([]);
            expect(kp.privateKey.usages).toContain('deriveKey');
        });

        it('should generate extractable keys by default', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey.extractable).toBe(true);
            expect(kp.privateKey.extractable).toBe(true);
        });

        it('should generate different key pairs each time', async () => {
            const kp1 = await makeKeyPair();
            const kp2 = await makeKeyPair();

            // Export and compare public keys as JWK
            const jwk1 = await exportPublicKey(kp1.publicKey);
            const jwk2 = await exportPublicKey(kp2.publicKey);

            // Different keys produce different JWKs
            expect(jwk1.x).not.toBe(jwk2.x);
            expect(jwk1.y).not.toBe(jwk2.y);
        });
    });

    describe('exportPublicKey / importPublicKey', () => {
        it('should export public key as JWK with expected fields', async () => {
            const kp = await makeKeyPair();

            const jwk = await exportPublicKey(kp.publicKey);

            expect(jwk.kty).toBe('EC');
            expect(jwk.crv).toBe('P-256');
            expect(jwk.x).toBeTruthy();
            expect(jwk.y).toBeTruthy();
            // Public key JWK should not have private component
            expect(jwk.d).toBeUndefined();
        });

        it('should import public key from JWK and restore a usable CryptoKey', async () => {
            const kp = await makeKeyPair();

            const jwk = await exportPublicKey(kp.publicKey);
            const restored = await importPublicKey(jwk);

            expect(restored).toBeInstanceOf(CryptoKey);
            expect(restored.type).toBe('public');
            expect(restored.algorithm.name).toBe('ECDH');
        });

        it('should produce a public key that can participate in ECDH after roundtrip', async () => {
            const alice = await makeKeyPair();
            const bob = await makeKeyPair();

            // Roundtrip Alice's public key through export → import
            const aliceJwk = await exportPublicKey(alice.publicKey);
            const aliceRestored = await importPublicKey(aliceJwk);

            // Bob derives secret using Alice's restored public key
            const secret1 = await deriveSharedSecret(bob.privateKey, aliceRestored);
            // Bob derives secret using Alice's original public key
            const secret2 = await deriveSharedSecret(bob.privateKey, alice.publicKey);

            // Both should encrypt the same way
            const testData = 'roundtrip check';
            const enc1 = await encrypt(secret1, testData);
            const dec = await decrypt(secret2, enc1);

            expect(dec).toBe(testData);
        });
    });

    describe('exportPrivateKey / importPrivateKey', () => {
        it('should export private key as PKCS#8 raw bytes', async () => {
            const kp = await makeKeyPair();

            const raw = await exportPrivateKey(kp.privateKey);

            expect(raw).toBeInstanceOf(Uint8Array);
            expect(raw.length).toBeGreaterThan(0);
        });

        it('should import private key with extractable=false for registered users', async () => {
            const kp = await makeKeyPair();

            const raw = await exportPrivateKey(kp.privateKey);
            const locked = await importPrivateKey(raw, false);

            expect(locked).toBeInstanceOf(CryptoKey);
            expect(locked.extractable).toBe(false);
            expect(locked.type).toBe('private');
        });

        it('should import private key with extractable=true for guest users', async () => {
            const kp = await makeKeyPair();

            const raw = await exportPrivateKey(kp.privateKey);
            const unlocked = await importPrivateKey(raw, true);

            expect(unlocked.extractable).toBe(true);
        });

        it('should produce a private key that can participate in ECDH after roundtrip', async () => {
            const alice = await makeKeyPair();
            const bob = await makeKeyPair();

            // Roundtrip Alice's private key through export → import (non-extractable)
            const rawAlice = await exportPrivateKey(alice.privateKey);
            const aliceRestored = await importPrivateKey(rawAlice, false);

            // Alice with restored private key + Bob's public key
            const secret1 = await deriveSharedSecret(aliceRestored, bob.publicKey);
            // Bob with his private key + Alice's original public key
            const secret2 = await deriveSharedSecret(bob.privateKey, alice.publicKey);

            // Secrets should be equivalent (encrypt with one, decrypt with other)
            const testData = 'ecdh private key roundtrip';
            const enc = await encrypt(secret1, testData);
            const dec = await decrypt(secret2, enc);

            expect(dec).toBe(testData);
        });

        it('should prevent export of non-extractable private key', async () => {
            const kp = await makeKeyPair();
            const raw = await exportPrivateKey(kp.privateKey);
            const locked = await importPrivateKey(raw, false);

            await expect(crypto.subtle.exportKey('pkcs8', locked)).rejects.toThrow();
        });
    });

    describe('deriveSharedSecret', () => {
        it('should derive a non-extractable AES-256-GCM shared secret', async () => {
            const alice = await makeKeyPair();
            const bob = await makeKeyPair();

            const secret = await deriveSharedSecret(alice.privateKey, bob.publicKey);

            expect(secret).toBeInstanceOf(CryptoKey);
            expect(secret.extractable).toBe(false);
            expect(secret.algorithm.name).toBe('AES-GCM');
            expect(secret.usages).toContain('encrypt');
            expect(secret.usages).toContain('decrypt');
        });

        it('should derive the same secret from both sides (ECDH symmetry)', async () => {
            const alice = await makeKeyPair();
            const bob = await makeKeyPair();

            const aliceSecret = await deriveSharedSecret(alice.privateKey, bob.publicKey);
            const bobSecret = await deriveSharedSecret(bob.privateKey, alice.publicKey);

            // Secrets are equivalent if they encrypt/decrypt cross-wise
            const plaintext = 'hello from alice';
            const encrypted = await encrypt(aliceSecret, plaintext);
            const decrypted = await decrypt(bobSecret, encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it('should derive different secrets for different key pairs', async () => {
            const alice = await makeKeyPair();
            const bob = await makeKeyPair();
            const charlie = await makeKeyPair();

            const aliceBobSecret = await deriveSharedSecret(alice.privateKey, bob.publicKey);
            const aliceCharlieSecret = await deriveSharedSecret(
                alice.privateKey,
                charlie.publicKey
            );

            // Alice–Bob secret cannot decrypt data encrypted for Alice–Charlie
            const plaintext = 'test';
            const encrypted = await encrypt(aliceBobSecret, plaintext);

            await expect(decrypt(aliceCharlieSecret, encrypted)).rejects.toThrow();
        });
    });

    describe('full registration/login flow simulation', () => {
        it('should complete E2EE identity key storage roundtrip (register → login)', async () => {
            // Simulate registration: generate key pair, wrap private key with M
            const masterKey = await generateMasterKey();
            const kp = await generateIdentityKeyPair();

            // Export for server storage
            const publicKeyJwk = await exportPublicKey(kp.publicKey);
            const rawPrivate = await exportPrivateKey(kp.privateKey);
            const encryptedPrivate = await encrypt(
                masterKey,
                JSON.stringify(Array.from(rawPrivate))
            );
            rawPrivate.fill(0);

            // Simulate server round-trip (store and retrieve strings)
            const storedPublicKeyJson = JSON.stringify(publicKeyJwk);
            const storedPrivateCiphertext = encryptedPrivate.ciphertext;
            const storedPrivateIv = encryptedPrivate.iv;

            // Simulate login: restore key pair from server fields
            const restoredPublicKey = await importPublicKey(
                JSON.parse(storedPublicKeyJson) as JsonWebKey
            );
            const restoredPrivateRawJson = await decrypt(masterKey, {
                ciphertext: storedPrivateCiphertext,
                iv: storedPrivateIv
            });
            const restoredPrivateRaw = new Uint8Array(
                JSON.parse(restoredPrivateRawJson) as number[]
            ) as Uint8Array<ArrayBuffer>;
            const restoredPrivateKey = await importPrivateKey(restoredPrivateRaw, false);
            restoredPrivateRaw.fill(0);

            // Verify restored key pair works for ECDH with a third party
            const bob = await generateIdentityKeyPair();
            const secretOriginal = await deriveSharedSecret(kp.privateKey, bob.publicKey);
            const secretRestored = await deriveSharedSecret(restoredPrivateKey, restoredPublicKey);

            // secretRestored (private) + bob.public should match secretOriginal
            const secretRestoredWithBob = await deriveSharedSecret(
                restoredPrivateKey,
                bob.publicKey
            );
            const testMsg = 'end-to-end identity key roundtrip';
            const enc = await encrypt(secretOriginal, testMsg);
            const dec = await decrypt(secretRestoredWithBob, enc);

            expect(dec).toBe(testMsg);
        });
    });
});
