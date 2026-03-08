/**
 * Crypto Module Tests: masterKey.ts
 *
 * Tests master key generation, wrapping, and unwrapping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	generateMasterKey,
	wrapMasterKey,
	unwrapMasterKey,
	importMasterKey,
	unwrapMasterKeyRaw
} from '$lib/crypto/masterKey';
import { generateSalt, deriveKeys } from '$lib/crypto/kdf';
import { AES_IV_BYTES } from '$lib/crypto/constants';

describe('masterKey', () => {
	describe('generateMasterKey', () => {
		it('should generate an AES-256-GCM key', async () => {
			const key = await generateMasterKey();

			expect(key).toBeInstanceOf(CryptoKey);
			expect(key.type).toBe('secret');
			expect(key.algorithm.name).toBe('AES-GCM');
		});

		it('should generate extractable key by default', async () => {
			const key = await generateMasterKey();

			expect(key.extractable).toBe(true);
		});

		it('should support encrypt and decrypt operations', async () => {
			const key = await generateMasterKey();

			expect(key.usages).toContain('encrypt');
			expect(key.usages).toContain('decrypt');
		});

		it('should generate different keys each time', async () => {
			const key1 = await generateMasterKey();
			const key2 = await generateMasterKey();

			// Can't compare CryptoKeys directly, but we can check they produce different ciphertext
			const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
			const plaintext = new TextEncoder().encode('test');

			const cipher1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, plaintext);
			const cipher2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key2, plaintext);

			// Same IV and plaintext but different keys = different ciphertext
			expect(new Uint8Array(cipher1)).not.toEqual(new Uint8Array(cipher2));
		});
	});

	describe('wrapMasterKey', () => {
		it('should wrap master key with wrapping key material', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);

			expect(wrapped.ciphertext).toBeInstanceOf(Uint8Array);
			expect(wrapped.iv).toBeInstanceOf(Uint8Array);
			// AES-GCM: 32 bytes key + 16 bytes auth tag = 48 bytes
			expect(wrapped.ciphertext.length).toBe(48);
			expect(wrapped.iv.length).toBe(AES_IV_BYTES);
		});

		it('should produce different ciphertext each time (random IV)', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped1 = await wrapMasterKey(masterKey, wrappingKey);
			const wrapped2 = await wrapMasterKey(masterKey, wrappingKey);

			expect(wrapped1.ciphertext).not.toEqual(wrapped2.ciphertext);
			expect(wrapped1.iv).not.toEqual(wrapped2.iv);
		});

		it('should produce different ciphertext for different wrapping keys', async () => {
			const masterKey = await generateMasterKey();
			const key1 = crypto.getRandomValues(new Uint8Array(32));
			const key2 = crypto.getRandomValues(new Uint8Array(32));

			const wrapped1 = await wrapMasterKey(masterKey, key1);
			const wrapped2 = await wrapMasterKey(masterKey, key2);

			expect(wrapped1.ciphertext).not.toEqual(wrapped2.ciphertext);
		});
	});

	describe('unwrapMasterKey', () => {
		it('should unwrap and import as non-extractable key', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const unwrapped = await unwrapMasterKey(wrapped.ciphertext, wrapped.iv, wrappingKey);

			expect(unwrapped).toBeInstanceOf(CryptoKey);
			expect(unwrapped.extractable).toBe(false); // Must be non-extractable for security
		});

		it('should unwrap to a functional AES-GCM key', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const unwrapped = await unwrapMasterKey(wrapped.ciphertext, wrapped.iv, wrappingKey);

			expect(unwrapped.algorithm.name).toBe('AES-GCM');
			expect(unwrapped.usages).toContain('encrypt');
			expect(unwrapped.usages).toContain('decrypt');
		});

		it('should unwrap to a key that encrypts/decrypts same as original', async () => {
			const originalKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(originalKey, wrappingKey);
			const unwrapped = await unwrapMasterKey(wrapped.ciphertext, wrapped.iv, wrappingKey);

			// Test both keys produce same results
			const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
			const plaintext = new TextEncoder().encode('test message');

			const cipher1 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, originalKey, plaintext)) as ArrayBuffer
			);
			const cipher2 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, unwrapped, plaintext)) as ArrayBuffer
			);

			expect(cipher1).toEqual(cipher2);
		});

		it('should fail to unwrap with wrong wrapping key', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey1 = crypto.getRandomValues(new Uint8Array(32));
			const wrappingKey2 = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey1);

			await expect(
				unwrapMasterKey(wrapped.ciphertext, wrapped.iv, wrappingKey2)
			).rejects.toThrow();
		});

		it('should fail to unwrap with wrong IV', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const wrongIv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));

			await expect(unwrapMasterKey(wrapped.ciphertext, wrongIv, wrappingKey)).rejects.toThrow();
		});

		it('should fail to unwrap tampered ciphertext', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const tampered = new Uint8Array(wrapped.ciphertext.map((b) => b ^ 0xff));

			await expect(unwrapMasterKey(tampered, wrapped.iv, wrappingKey)).rejects.toThrow();
		});
	});

	describe('importMasterKey', () => {
		it('should import raw bytes as extractable CryptoKey', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importMasterKey(rawKey, true);

			expect(key.extractable).toBe(true);
			expect(key.algorithm.name).toBe('AES-GCM');
		});

		it('should import raw bytes as non-extractable CryptoKey', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importMasterKey(rawKey, false);

			expect(key.extractable).toBe(false);
		});

		it('should import to a functional key', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));
			const key = await importMasterKey(rawKey, true);

			const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
			const plaintext = new TextEncoder().encode('test');

			const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
			const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

			expect(new Uint8Array(decrypted)).toEqual(plaintext);
		});
	});

	describe('unwrapMasterKeyRaw', () => {
		it('should unwrap and return raw bytes', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const rawBytes = await unwrapMasterKeyRaw(wrapped.ciphertext, wrapped.iv, wrappingKey);

			expect(rawBytes).toBeInstanceOf(Uint8Array);
			expect(rawBytes.length).toBe(32); // 256 bits = 32 bytes
		});

		it('should unwrap to bytes that can be re-imported', async () => {
			const masterKey = await generateMasterKey();
			const wrappingKey = crypto.getRandomValues(new Uint8Array(32));

			const wrapped = await wrapMasterKey(masterKey, wrappingKey);
			const rawBytes = await unwrapMasterKeyRaw(wrapped.ciphertext, wrapped.iv, wrappingKey);

			const reimported = await importMasterKey(rawBytes, true);

			// Both keys should work the same
			const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
			const plaintext = new TextEncoder().encode('test');

			const cipher1 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, plaintext)) as ArrayBuffer
			);
			const cipher2 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, reimported, plaintext)) as ArrayBuffer
			);

			expect(cipher1).toEqual(cipher2);
		});
	});

	describe('full key wrapping flow (with KDF)', () => {
		it('should complete full wrap/unwrap flow with KDF-derived keys', async () => {
			// Simulate registration flow
			const password = 'test-password-123';
			const salt = generateSalt();
			const { encryptionKey } = await deriveKeys(password, salt);

			// Generate and wrap master key
			const masterKey = await generateMasterKey();
			const wrapped = await wrapMasterKey(masterKey, encryptionKey);

			// Simulate login flow - derive keys again and unwrap
			const { encryptionKey: loginDerivedKey } = await deriveKeys(password, salt);
			const unwrapped = await unwrapMasterKey(
				wrapped.ciphertext,
				wrapped.iv,
				loginDerivedKey
			);

			// Verify unwrapped key works
			const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
			const plaintext = new TextEncoder().encode('secret message');

			const cipher1 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, plaintext)) as ArrayBuffer
			);
			const cipher2 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, unwrapped, plaintext)) as ArrayBuffer
			);

			expect(cipher1).toEqual(cipher2);
		});

		it('should fail with wrong password in full flow', async () => {
			const password = 'test-password-123';
			const wrongPassword = 'wrong-password';
			const salt = generateSalt();
			const { encryptionKey } = await deriveKeys(password, salt);

			const masterKey = await generateMasterKey();
			const wrapped = await wrapMasterKey(masterKey, encryptionKey);

			// Try to unwrap with wrong password
			const { encryptionKey: wrongKey } = await deriveKeys(wrongPassword, salt);

			await expect(
				unwrapMasterKey(wrapped.ciphertext, wrapped.iv, wrongKey)
			).rejects.toThrow();
		});
	});
});
