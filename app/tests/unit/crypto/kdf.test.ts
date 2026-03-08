/**
 * Crypto Module Tests: kdf.ts
 *
 * Tests PBKDF2 key derivation and related functions.
 */

import { describe, it, expect } from 'vitest';
import { generateSalt, deriveKeys, importWrappingKey } from '$lib/crypto/kdf';
import { SALT_BYTES, KDF_ITERATIONS } from '$lib/crypto/constants';

describe('kdf', () => {
	describe('generateSalt', () => {
		it('should generate a salt of correct length', () => {
			const salt = generateSalt();

			expect(salt).toBeInstanceOf(Uint8Array);
			expect(salt.length).toBe(SALT_BYTES);
		});

		it('should generate different salts each time', () => {
			const salt1 = generateSalt();
			const salt2 = generateSalt();

			expect(salt1).not.toEqual(salt2);
		});

		it('should generate cryptographically random salts', () => {
			// Generate 100 salts and check they're all different
			const salts = new Set<string>();
			for (let i = 0; i < 100; i++) {
				const salt = generateSalt();
				salts.add(Array.from(salt).join(','));
			}

			expect(salts.size).toBe(100);
		});
	});

	describe('deriveKeys', () => {
		it('should derive two 256-bit keys from password and salt', async () => {
			const password = 'test-password-123';
			const salt = generateSalt();

			const { loginKey, encryptionKey } = await deriveKeys(password, salt);

			expect(loginKey).toBeInstanceOf(Uint8Array);
			expect(encryptionKey).toBeInstanceOf(Uint8Array);

			// Each key should be 32 bytes (256 bits)
			expect(loginKey.length).toBe(32);
			expect(encryptionKey.length).toBe(32);
		});

		it('should produce consistent results for same inputs', async () => {
			const password = 'test-password-123';
			const salt = generateSalt();

			const { loginKey: key1, encryptionKey: enc1 } = await deriveKeys(password, salt);
			const { loginKey: key2, encryptionKey: enc2 } = await deriveKeys(password, salt);

			expect(key1).toEqual(key2);
			expect(enc1).toEqual(enc2);
		});

		it('should produce different results for different passwords', async () => {
			const salt = generateSalt();

			const { loginKey: key1, encryptionKey: enc1 } = await deriveKeys('password1', salt);
			const { loginKey: key2, encryptionKey: enc2 } = await deriveKeys('password2', salt);

			expect(key1).not.toEqual(key2);
			expect(enc1).not.toEqual(enc2);
		});

		it('should produce different results for different salts', async () => {
			const password = 'test-password';
			const salt1 = generateSalt();
			const salt2 = generateSalt();

			const { loginKey: key1, encryptionKey: enc1 } = await deriveKeys(password, salt1);
			const { loginKey: key2, encryptionKey: enc2 } = await deriveKeys(password, salt2);

			expect(key1).not.toEqual(key2);
			expect(enc1).not.toEqual(enc2);
		});

		it('should derive independent keys (loginKey != encryptionKey)', async () => {
			const password = 'test-password-123';
			const salt = generateSalt();

			const { loginKey, encryptionKey } = await deriveKeys(password, salt);

			expect(loginKey).not.toEqual(encryptionKey);
		});

		it('should handle empty password', async () => {
			const password = '';
			const salt = generateSalt();

			const { loginKey, encryptionKey } = await deriveKeys(password, salt);

			expect(loginKey.length).toBe(32);
			expect(encryptionKey.length).toBe(32);
		});

		it('should handle unicode passwords', async () => {
			const password = 'パスワード 🔑 비밀번호';
			const salt = generateSalt();

			const { loginKey, encryptionKey } = await deriveKeys(password, salt);

			expect(loginKey.length).toBe(32);
			expect(encryptionKey.length).toBe(32);
		});

		it('should handle very long passwords', async () => {
			const password = 'a'.repeat(10000);
			const salt = generateSalt();

			const { loginKey, encryptionKey } = await deriveKeys(password, salt);

			expect(loginKey.length).toBe(32);
			expect(encryptionKey.length).toBe(32);
		});
	});

	describe('importWrappingKey', () => {
		it('should import raw bytes as AES-GCM key', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importWrappingKey(rawKey);

			expect(key).toBeInstanceOf(CryptoKey);
			expect(key.type).toBe('secret');
			expect(key.algorithm.name).toBe('AES-GCM');
		});

		it('should import as extractable by default', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importWrappingKey(rawKey, true);

			expect(key.extractable).toBe(true);
		});

		it('should import as non-extractable when specified', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importWrappingKey(rawKey, false);

			expect(key.extractable).toBe(false);
		});

		it('should support encrypt and decrypt operations', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));

			const key = await importWrappingKey(rawKey);

			expect(key.usages).toContain('encrypt');
			expect(key.usages).toContain('decrypt');
		});

		it('should correctly encrypt/decrypt with imported key', async () => {
			const rawKey = crypto.getRandomValues(new Uint8Array(32));
			const key = await importWrappingKey(rawKey);
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const plaintext = new TextEncoder().encode('Test message');

			const ciphertext = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)) as ArrayBuffer
			);

			const decrypted = new Uint8Array(
				(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)) as ArrayBuffer
			);

			expect(decrypted).toEqual(plaintext);
		});
	});
}, 15000);
