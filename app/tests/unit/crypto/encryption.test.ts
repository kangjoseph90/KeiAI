/**
 * Crypto Module Tests: encryption.ts
 *
 * Tests AES-256-GCM encryption/decryption operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, encryptBytes, decryptBytes } from '$lib/crypto/encryption';
import type { EncryptedData } from '$lib/crypto/types';

// Helper to create a test master key
async function createTestMasterKey(extractable = true): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
		'encrypt',
		'decrypt'
	]);
}

describe('encryption', () => {
	describe('encrypt/decrypt (string)', () => {
		it('should encrypt and decrypt plaintext correctly', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'Hello, World!';

			const encrypted = await encrypt(masterKey, plaintext);

			expect(encrypted).toBeDefined();
			expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
			expect(encrypted.iv).toBeInstanceOf(Uint8Array);
			expect(encrypted.ciphertext.length).toBeGreaterThan(0);
			expect(encrypted.iv.length).toBe(12); // AES-GCM IV is always 12 bytes

			const decrypted = await decrypt(masterKey, encrypted);
			expect(decrypted).toBe(plaintext);
		});

		it('should produce different ciphertext for each encryption (random IV)', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'Same plaintext';

			const encrypted1 = await encrypt(masterKey, plaintext);
			const encrypted2 = await encrypt(masterKey, plaintext);

			// Ciphertexts should differ due to random IV
			expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
			expect(encrypted1.iv).not.toEqual(encrypted2.iv);

			// But both should decrypt to the same plaintext
			expect(await decrypt(masterKey, encrypted1)).toBe(plaintext);
			expect(await decrypt(masterKey, encrypted2)).toBe(plaintext);
		});

		it('should handle empty string', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = '';

			const encrypted = await encrypt(masterKey, plaintext);
			const decrypted = await decrypt(masterKey, encrypted);

			expect(decrypted).toBe(plaintext);
		});

		it('should handle unicode characters', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'Hello 世界 🌍 님안하세요';

			const encrypted = await encrypt(masterKey, plaintext);
			const decrypted = await decrypt(masterKey, encrypted);

			expect(decrypted).toBe(plaintext);
		});

		it('should handle long text', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'a'.repeat(10000);

			const encrypted = await encrypt(masterKey, plaintext);
			const decrypted = await decrypt(masterKey, encrypted);

			expect(decrypted).toBe(plaintext);
		});

		it('should handle JSON data', async () => {
			const masterKey = await createTestMasterKey();
			const data = {
				name: 'Test User',
				email: 'test@example.com',
				settings: { theme: 'dark', notifications: true }
			};
			const plaintext = JSON.stringify(data);

			const encrypted = await encrypt(masterKey, plaintext);
			const decrypted = await decrypt(masterKey, encrypted);
			const parsed = JSON.parse(decrypted);

			expect(parsed).toEqual(data);
		});

		it('should throw error when decrypting with wrong key', async () => {
			const key1 = await createTestMasterKey();
			const key2 = await createTestMasterKey();
			const plaintext = 'Secret message';

			const encrypted = await encrypt(key1, plaintext);

			await expect(decrypt(key2, encrypted)).rejects.toThrow();
		});

		it('should throw error when decrypting tampered data', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'Secret message';

			const encrypted = await encrypt(masterKey, plaintext);

			// Tamper with ciphertext
			const tampered: EncryptedData = {
				ciphertext: new Uint8Array([...encrypted.ciphertext.map((b) => b ^ 0xff)]),
				iv: encrypted.iv
			};

			await expect(decrypt(masterKey, tampered)).rejects.toThrow();
		});

		it('should throw error when decrypting with wrong IV', async () => {
			const masterKey = await createTestMasterKey();
			const plaintext = 'Secret message';

			const encrypted = await encrypt(masterKey, plaintext);

			// Wrong IV
			const wrongIv: EncryptedData = {
				ciphertext: encrypted.ciphertext,
				iv: crypto.getRandomValues(new Uint8Array(12))
			};

			await expect(decrypt(masterKey, wrongIv)).rejects.toThrow();
		});
	});

	describe('encryptBytes/decryptBytes (raw bytes)', () => {
		it('should encrypt and decrypt raw bytes', async () => {
			const masterKey = await createTestMasterKey();
			const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);

			const encrypted = await encryptBytes(masterKey, data);
			const decrypted = await decryptBytes(masterKey, encrypted);

			expect(decrypted).toEqual(data);
		});

		it('should handle empty byte array', async () => {
			const masterKey = await createTestMasterKey();
			const data = new Uint8Array(0);

			const encrypted = await encryptBytes(masterKey, data);
			const decrypted = await decryptBytes(masterKey, encrypted);

			expect(decrypted).toEqual(data);
		});

		it('should handle 32-byte key material', async () => {
			const masterKey = await createTestMasterKey();
			const keyMaterial = crypto.getRandomValues(new Uint8Array(32));

			const encrypted = await encryptBytes(masterKey, keyMaterial);
			const decrypted = await decryptBytes(masterKey, encrypted);

			expect(decrypted).toEqual(keyMaterial);
		});

		it('should produce different ciphertext for each encryption', async () => {
			const masterKey = await createTestMasterKey();
			const data = new Uint8Array([0x01, 0x02, 0x03]);

			const encrypted1 = await encryptBytes(masterKey, data);
			const encrypted2 = await encryptBytes(masterKey, data);

			expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
		});
	});
});
