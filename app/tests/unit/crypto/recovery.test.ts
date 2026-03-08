/**
 * Crypto Module Tests: recovery.ts
 *
 * Tests recovery code generation and key recovery.
 */

import { describe, it, expect } from 'vitest';
import {
	generateRecoveryCode,
	splitRecoveryCode,
	deriveRecoveryKey,
	hashRecoveryAuthToken,
	createRecoveryData,
	recoverMasterKey
} from '$lib/crypto/recovery';
import { generateMasterKey } from '$lib/crypto/masterKey';
import { RECOVERY_CODE_LENGTH, RECOVERY_FRONT_LENGTH, RECOVERY_BACK_LENGTH } from '$lib/crypto/constants';

describe('recovery', () => {
	describe('generateRecoveryCode', () => {
		it('should generate a 16-character code', () => {
			const code = generateRecoveryCode();

			expect(code.fullCode).toHaveLength(RECOVERY_CODE_LENGTH);
		});

		it('should split code into two 8-character halves', () => {
			const code = generateRecoveryCode();

			expect(code.frontHalf).toHaveLength(RECOVERY_FRONT_LENGTH);
			expect(code.backHalf).toHaveLength(RECOVERY_BACK_LENGTH);
		});

		it('should only use allowed characters (no ambiguous chars)', () => {
			const code = generateRecoveryCode();
			const allowedCharset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

			for (const char of code.fullCode) {
				expect(allowedCharset).toContain(char);
			}
		});

		it('should not contain 0, O, 1, I, or L', () => {
			const code = generateRecoveryCode();
			const ambiguousChars = ['0', 'O', '1', 'I', 'L'];

			for (const char of code.fullCode) {
				expect(ambiguousChars).not.toContain(char);
			}
		});

		it('should generate different codes each time', () => {
			const codes = new Set<string>();
			for (let i = 0; i < 100; i++) {
				const code = generateRecoveryCode();
				codes.add(code.fullCode);
			}

			expect(codes.size).toBe(100);
		});

		it('should have approximately correct entropy', () => {
			// With 30 chars and 8 positions, we expect good distribution
			const charCounts: Record<string, number> = {};
			const iterations = 1000;

			for (let i = 0; i < iterations; i++) {
				const code = generateRecoveryCode();
				for (const char of code.fullCode) {
					charCounts[char] = (charCounts[char] || 0) + 1;
				}
			}

			// Each character should appear roughly 1/30 of the time
			const expectedCount = (iterations * RECOVERY_CODE_LENGTH) / 30;
			for (const count of Object.values(charCounts)) {
				// Allow ±40% variance (very loose check due to randomness)
				expect(count).toBeGreaterThan(expectedCount * 0.6);
				expect(count).toBeLessThan(expectedCount * 1.4);
			}
		});
	});

	describe('splitRecoveryCode', () => {
		it('should split a valid 16-char code', () => {
			const code = 'ABCD1234EFGH5678';
			const parts = splitRecoveryCode(code);

			expect(parts.fullCode).toBe(code);
			expect(parts.frontHalf).toBe('ABCD1234');
			expect(parts.backHalf).toBe('EFGH5678');
		});

		it('should throw error for code that is too short', () => {
			expect(() => splitRecoveryCode('SHORT')).toThrow();
		});

		it('should throw error for code that is too long', () => {
			expect(() => splitRecoveryCode('TOO_LONG_CODE_12345')).toThrow();
		});

		it('should split correctly for generated code', () => {
			const generated = generateRecoveryCode();
			const split = splitRecoveryCode(generated.fullCode);

			expect(split.fullCode).toBe(generated.fullCode);
			expect(split.frontHalf).toBe(generated.frontHalf);
			expect(split.backHalf).toBe(generated.backHalf);
		});
	});

	describe('deriveRecoveryKey', () => {
		it('should derive a 256-bit key from front half', async () => {
			const frontHalf = 'ABCD1234';
			const key = await deriveRecoveryKey(frontHalf);

			expect(key).toBeInstanceOf(Uint8Array);
			expect(key.length).toBe(32); // 256 bits
		});

		it('should produce consistent results for same input', async () => {
			const frontHalf = 'EFGH5678';

			const key1 = await deriveRecoveryKey(frontHalf);
			const key2 = await deriveRecoveryKey(frontHalf);

			expect(key1).toEqual(key2);
		});

		it('should produce different results for different inputs', async () => {
			const key1 = await deriveRecoveryKey('ABCD1234');
			const key2 = await deriveRecoveryKey('EFGH5678');

			expect(key1).not.toEqual(key2);
		});

		it('should handle all allowed characters', async () => {
			const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

			for (const char of charset) {
				const input = char + 'BCD1234'; // Just use one different char
				const key = await deriveRecoveryKey(input);

				expect(key.length).toBe(32);
			}
		});
	});

	describe('hashRecoveryAuthToken', () => {
		it('should hash back half to 32 bytes (SHA-256)', async () => {
			const backHalf = 'EFGH5678';
			const hash = await hashRecoveryAuthToken(backHalf);

			expect(hash).toBeInstanceOf(Uint8Array);
			expect(hash.length).toBe(32); // SHA-256 output
		});

		it('should produce consistent hashes', async () => {
			const backHalf = '5678EFGH';

			const hash1 = await hashRecoveryAuthToken(backHalf);
			const hash2 = await hashRecoveryAuthToken(backHalf);

			expect(hash1).toEqual(hash2);
		});

		it('should produce different hashes for different inputs', async () => {
			const hash1 = await hashRecoveryAuthToken('ABCD1234');
			const hash2 = await hashRecoveryAuthToken('EFGH5678');

			expect(hash1).not.toEqual(hash2);
		});

		it('should be deterministic for same input', async () => {
			const backHalf = 'TEST1234';

			const hashes = await Promise.all(
				Array.from({ length: 10 }, () => hashRecoveryAuthToken(backHalf))
			);

			// All hashes should be identical
			for (let i = 1; i < hashes.length; i++) {
				expect(hashes[i]).toEqual(hashes[0]);
			}
		});
	});

	describe('createRecoveryData', () => {
		it('should create recovery data with all required fields', async () => {
			const masterKey = await generateMasterKey();
			const data = await createRecoveryData(masterKey);

			expect(data.recoveryCode).toBeDefined();
			expect(data.recoveryCode.fullCode).toHaveLength(RECOVERY_CODE_LENGTH);
			expect(data.encryptedRecoveryMasterKey).toBeInstanceOf(Uint8Array);
			expect(data.encryptedRecoveryMasterKeyIV).toBeInstanceOf(Uint8Array);
			expect(data.recoveryAuthTokenHash).toBeInstanceOf(Uint8Array);
		});

		it('should encrypt master key with recovery key', async () => {
			const masterKey = await generateMasterKey();
			const data = await createRecoveryData(masterKey);

			// AES-GCM: 32 bytes key + 16 bytes auth tag = 48 bytes
			expect(data.encryptedRecoveryMasterKey.length).toBe(48);
			expect(data.encryptedRecoveryMasterKeyIV.length).toBe(12); // AES-GCM IV
		});

		it('should generate auth token hash of correct size', async () => {
			const masterKey = await generateMasterKey();
			const data = await createRecoveryData(masterKey);

			expect(data.recoveryAuthTokenHash.length).toBe(32); // SHA-256
		});

		it('should generate different recovery data each time', async () => {
			const masterKey = await generateMasterKey();

			const data1 = await createRecoveryData(masterKey);
			const data2 = await createRecoveryData(masterKey);

			// Recovery codes should be different
			expect(data1.recoveryCode.fullCode).not.toEqual(data2.recoveryCode.fullCode);

			// Encrypted keys should also be different (different IV)
			expect(data1.encryptedRecoveryMasterKey).not.toEqual(data2.encryptedRecoveryMasterKey);
		});
	});

	describe('recoverMasterKey', () => {
		it('should recover master key using full recovery code', async () => {
			const originalKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(originalKey);

			const recoveredKey = await recoverMasterKey(
				recoveryData.recoveryCode.fullCode,
				recoveryData.encryptedRecoveryMasterKey,
				recoveryData.encryptedRecoveryMasterKeyIV
			);

			expect(recoveredKey).toBeInstanceOf(CryptoKey);
			expect(recoveredKey.extractable).toBe(false); // Should be non-extractable
			expect(recoveredKey.algorithm.name).toBe('AES-GCM');
		});

		it('should recover a key that encrypts/decrypts same as original', async () => {
			const originalKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(originalKey);

			const recoveredKey = await recoverMasterKey(
				recoveryData.recoveryCode.fullCode,
				recoveryData.encryptedRecoveryMasterKey,
				recoveryData.encryptedRecoveryMasterKeyIV
			);

			// Test both keys produce same encryption results
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const plaintext = new TextEncoder().encode('test message');

			const cipher1 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, originalKey, plaintext)) as ArrayBuffer
			);
			const cipher2 = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, recoveredKey, plaintext)) as ArrayBuffer
			);

			expect(cipher1).toEqual(cipher2);
		});

		it('should fail with wrong recovery code', async () => {
			const originalKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(originalKey);

			// Use wrong code
			const wrongCode = 'WRONGCODE1234567';

			await expect(
				recoverMasterKey(
					wrongCode,
					recoveryData.encryptedRecoveryMasterKey,
					recoveryData.encryptedRecoveryMasterKeyIV
				)
			).rejects.toThrow();
		});

		it('should fail with tampered encrypted data', async () => {
			const originalKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(originalKey);

			// Tamper with encrypted data
			const tampered = new Uint8Array(
				recoveryData.encryptedRecoveryMasterKey.map((b) => b ^ 0xff)
			);

			await expect(
				recoverMasterKey(
					recoveryData.recoveryCode.fullCode,
					tampered,
					recoveryData.encryptedRecoveryMasterKeyIV
				)
			).rejects.toThrow();
		});

		it('should fail with wrong IV', async () => {
			const originalKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(originalKey);

			const wrongIv = crypto.getRandomValues(new Uint8Array(12));

			await expect(
				recoverMasterKey(
					recoveryData.recoveryCode.fullCode,
					recoveryData.encryptedRecoveryMasterKey,
					wrongIv
				)
			).rejects.toThrow();
		});
	});

	describe('full recovery flow', () => {
		it('should complete full create and recover flow', async () => {
			// User registers - create recovery data
			const masterKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(masterKey);

			// User loses password, initiates recovery with their code
			const recoveredKey = await recoverMasterKey(
				recoveryData.recoveryCode.fullCode,
				recoveryData.encryptedRecoveryMasterKey,
				recoveryData.encryptedRecoveryMasterKeyIV
			);

			// Verify the recovered key works for encryption/decryption
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const originalPlaintext = 'My secret data';

			const encrypted = new Uint8Array(
				(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, recoveredKey, new TextEncoder().encode(originalPlaintext))) as ArrayBuffer
			);

			const decrypted = new Uint8Array(
				(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, recoveredKey, encrypted)) as ArrayBuffer
			);

			expect(new TextDecoder().decode(decrypted)).toBe(originalPlaintext);
		});

		it('should fail recovery with even one wrong character', async () => {
			const masterKey = await generateMasterKey();
			const recoveryData = await createRecoveryData(masterKey);

			// Flip the first character to something completely different
			const originalChar = recoveryData.recoveryCode.fullCode[0];
			// Find a character that's at least 5 positions away in the charset
			const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
			const originalIndex = charset.indexOf(originalChar);
			const wrongCharIndex = (originalIndex + 15) % charset.length;
			const wrongChar = charset[wrongCharIndex];

			const wrongCode = wrongChar + recoveryData.recoveryCode.fullCode.slice(1);

			await expect(
				recoverMasterKey(
					wrongCode,
					recoveryData.encryptedRecoveryMasterKey,
					recoveryData.encryptedRecoveryMasterKeyIV
				)
			).rejects.toThrow();
		});
	});
});
