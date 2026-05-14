/**
 * Crypto Module Tests: identityKey.ts
 *
 * Tests RSA-OAEP identity key generation, export/import, and room key wrapping.
 * Uses real Web Crypto API (no mocking) as required for crypto tests.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    decryptWithIdentity,
    encryptForIdentity,
    exportPrivateKey,
    exportPublicKey,
    generateIdentityKeyPair,
    importPrivateKey,
    importPublicKey,
    unwrapKeyWithIdentity,
    wrapKeyForIdentity
} from '$lib/crypto/identityKey';
import { decrypt, encrypt } from '$lib/crypto/encryption';
import { generateMasterKey } from '$lib/crypto/masterKey';

vi.setConfig({ testTimeout: 15_000 });

// ─── Helpers ─────────────────────────────────────────────────────────

/** Generate a fresh key pair for tests (private key extractable). */
async function makeKeyPair(): Promise<CryptoKeyPair> {
    return generateIdentityKeyPair();
}

describe('identityKey', () => {
    describe('generateIdentityKeyPair', () => {
        it('should generate an RSA-OAEP key pair', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey).toBeInstanceOf(CryptoKey);
            expect(kp.privateKey).toBeInstanceOf(CryptoKey);
            expect(kp.publicKey.algorithm.name).toBe('RSA-OAEP');
            expect(kp.privateKey.algorithm.name).toBe('RSA-OAEP');
        });

        it('should have correct key types', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey.type).toBe('public');
            expect(kp.privateKey.type).toBe('private');
        });

        it('should have correct usages', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey.usages).toEqual(['encrypt']);
            expect(kp.privateKey.usages).toEqual(['decrypt']);
        });

        it('should generate extractable keys by default', async () => {
            const kp = await makeKeyPair();

            expect(kp.publicKey.extractable).toBe(true);
            expect(kp.privateKey.extractable).toBe(true);
        });

        it('should generate different key pairs each time', async () => {
            const kp1 = await makeKeyPair();
            const kp2 = await makeKeyPair();

            const jwk1 = await exportPublicKey(kp1.publicKey);
            const jwk2 = await exportPublicKey(kp2.publicKey);

            expect(jwk1.n).not.toBe(jwk2.n);
        });
    });

    describe('exportPublicKey / importPublicKey', () => {
        it('should export public key as JWK with expected fields', async () => {
            const kp = await makeKeyPair();

            const jwk = await exportPublicKey(kp.publicKey);

            expect(jwk.kty).toBe('RSA');
            expect(jwk.alg).toBe('RSA-OAEP-256');
            expect(jwk.n).toBeTruthy();
            expect(jwk.e).toBeTruthy();
            expect(jwk.d).toBeUndefined();
        });

        it('should import public key from JWK and restore a usable CryptoKey', async () => {
            const kp = await makeKeyPair();

            const jwk = await exportPublicKey(kp.publicKey);
            const restored = await importPublicKey(jwk);

            expect(restored).toBeInstanceOf(CryptoKey);
            expect(restored.type).toBe('public');
            expect(restored.algorithm.name).toBe('RSA-OAEP');
            expect(restored.usages).toEqual(['encrypt']);
        });

        it('should produce a public key that can encrypt after roundtrip', async () => {
            const kp = await makeKeyPair();

            const jwk = await exportPublicKey(kp.publicKey);
            const restored = await importPublicKey(jwk);

            const data = new TextEncoder().encode('roundtrip check') as Uint8Array<ArrayBuffer>;
            const encrypted = await encryptForIdentity(restored, data);
            const decrypted = await decryptWithIdentity(kp.privateKey, encrypted);

            expect(new TextDecoder().decode(decrypted)).toBe('roundtrip check');
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
            expect(locked.usages).toEqual(['decrypt']);
        });

        it('should import private key with extractable=true for guest users', async () => {
            const kp = await makeKeyPair();

            const raw = await exportPrivateKey(kp.privateKey);
            const unlocked = await importPrivateKey(raw, true);

            expect(unlocked.extractable).toBe(true);
        });

        it('should produce a private key that can decrypt after roundtrip', async () => {
            const kp = await makeKeyPair();

            const raw = await exportPrivateKey(kp.privateKey);
            const restored = await importPrivateKey(raw, false);

            const data = new TextEncoder().encode(
                'private key roundtrip'
            ) as Uint8Array<ArrayBuffer>;
            const encrypted = await encryptForIdentity(kp.publicKey, data);
            const decrypted = await decryptWithIdentity(restored, encrypted);

            expect(new TextDecoder().decode(decrypted)).toBe('private key roundtrip');
        });

        it('should prevent export of non-extractable private key', async () => {
            const kp = await makeKeyPair();
            const raw = await exportPrivateKey(kp.privateKey);
            const locked = await importPrivateKey(raw, false);

            await expect(crypto.subtle.exportKey('pkcs8', locked)).rejects.toThrow();
        });
    });

    describe('encryptForIdentity / decryptWithIdentity', () => {
        it('should encrypt bytes for another identity and decrypt with that identity', async () => {
            const bob = await makeKeyPair();
            const data = new TextEncoder().encode('room secret') as Uint8Array<ArrayBuffer>;

            const encrypted = await encryptForIdentity(bob.publicKey, data);
            const decrypted = await decryptWithIdentity(bob.privateKey, encrypted);

            expect(new TextDecoder().decode(decrypted)).toBe('room secret');
        });

        it('should fail to decrypt with the wrong private key', async () => {
            const bob = await makeKeyPair();
            const charlie = await makeKeyPair();
            const data = new TextEncoder().encode('room secret') as Uint8Array<ArrayBuffer>;

            const encrypted = await encryptForIdentity(bob.publicKey, data);

            await expect(decryptWithIdentity(charlie.privateKey, encrypted)).rejects.toThrow();
        }, 15_000);
    });

    describe('wrapKeyForIdentity / unwrapKeyWithIdentity', () => {
        it('should wrap an AES-GCM key for another identity and unwrap a usable key', async () => {
            const bob = await makeKeyPair();
            const roomKey = await generateMasterKey();

            const wrapped = await wrapKeyForIdentity(bob.publicKey, roomKey);
            const unwrapped = await unwrapKeyWithIdentity(bob.privateKey, wrapped);

            const encrypted = await encrypt(roomKey, 'hello shared room');
            const decrypted = await decrypt(unwrapped, encrypted);

            expect(decrypted).toBe('hello shared room');
        });

        it('should unwrap an AES-GCM key as non-extractable', async () => {
            const bob = await makeKeyPair();
            const roomKey = await generateMasterKey();

            const wrapped = await wrapKeyForIdentity(bob.publicKey, roomKey);
            const unwrapped = await unwrapKeyWithIdentity(bob.privateKey, wrapped, false);

            expect(unwrapped.extractable).toBe(false);
            await expect(crypto.subtle.exportKey('raw', unwrapped)).rejects.toThrow();
        });
    });

    describe('full registration/login flow simulation', () => {
        it('should complete E2EE identity key storage roundtrip (register -> login)', async () => {
            const masterKey = await generateMasterKey();
            const kp = await generateIdentityKeyPair();

            const publicKeyJwk = await exportPublicKey(kp.publicKey);
            const rawPrivate = await exportPrivateKey(kp.privateKey);
            const encryptedPrivate = await encrypt(
                masterKey,
                JSON.stringify(Array.from(rawPrivate))
            );
            rawPrivate.fill(0);

            const storedPublicKeyJson = JSON.stringify(publicKeyJwk);
            const storedPrivateCiphertext = encryptedPrivate.ciphertext;
            const storedPrivateIv = encryptedPrivate.iv;

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

            const roomKey = await generateMasterKey();
            const wrapped = await wrapKeyForIdentity(restoredPublicKey, roomKey);
            const unwrapped = await unwrapKeyWithIdentity(restoredPrivateKey, wrapped);
            const encrypted = await encrypt(roomKey, 'end-to-end identity key roundtrip');
            const decrypted = await decrypt(unwrapped, encrypted);

            expect(decrypted).toBe('end-to-end identity key roundtrip');
        });
    });
});
