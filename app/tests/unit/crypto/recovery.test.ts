import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    generateRecoveryCode,
    splitRecoveryCode,
    deriveRecoveryKey,
    hashRecoveryAuthToken,
    createRecoveryData,
    recoverMasterKey
} from '$lib/crypto/recovery';
import { RECOVERY_CODE_LENGTH, RECOVERY_FRONT_LENGTH } from '$lib/crypto/constants';
import { wrapMasterKey } from '$lib/crypto/masterKey';

// Mock masterKey module to avoid generating real CryptoKeys if possible,
// but for unwrap/recover we might need real ones.
vi.mock('$lib/crypto/masterKey', () => ({
    wrapMasterKey: vi.fn()
}));

describe('Crypto Recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Recovery Code Generation', () => {
        it('should generate a code of correct length', () => {
            const code = generateRecoveryCode();
            expect(code.fullCode).toHaveLength(RECOVERY_CODE_LENGTH);
            expect(code.frontHalf).toHaveLength(RECOVERY_FRONT_LENGTH);
            expect(code.backHalf).toHaveLength(RECOVERY_CODE_LENGTH - RECOVERY_FRONT_LENGTH);
        });

        it('should generate different codes on subsequent calls', () => {
            const code1 = generateRecoveryCode().fullCode;
            const code2 = generateRecoveryCode().fullCode;
            expect(code1).not.toBe(code2);
        });

        it('splitRecoveryCode should correctly split a valid code', () => {
            const code = 'ABCDEFGH12345678';
            const parts = splitRecoveryCode(code);
            expect(parts.frontHalf).toBe('ABCDEFGH');
            expect(parts.backHalf).toBe('12345678');
        });

        it('splitRecoveryCode should throw on invalid length', () => {
            expect(() => splitRecoveryCode('SHORT')).toThrow();
        });
    });

    describe('Derivation and Hashing', () => {
        it('deriveRecoveryKey should produce consistent 32-byte key', async () => {
            const front = 'ABCDEFGH';
            const key1 = await deriveRecoveryKey(front);
            const key2 = await deriveRecoveryKey(front);

            expect(key1).toHaveLength(32);
            expect(key1).toEqual(key2);
        });

        it('hashRecoveryAuthToken should produce consistent 32-byte hash', async () => {
            const back = '12345678';
            const hash1 = await hashRecoveryAuthToken(back);
            const hash2 = await hashRecoveryAuthToken(back);

            expect(hash1).toHaveLength(32);
            expect(hash1).toEqual(hash2);
        });
    });

    describe('Full Recovery Flow', () => {
        it('should create recovery data and recover the master key', async () => {
            // 1. Generate a real master key for testing
            const masterKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );

            // 2. Mock wrapMasterKey to actually perform encryption so we can test recoverMasterKey
            // Instead of mocking, we could use the real wrapMasterKey if we didn't mock it above.
            // Let's use the real one for this test to ensure full flow works.
            vi.mocked(wrapMasterKey).mockImplementation(async (mk, wkBytes) => {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const wrappingKey = await crypto.subtle.importKey(
                    'raw',
                    wkBytes,
                    { name: 'AES-GCM' },
                    false,
                    ['encrypt']
                );
                const rawMK = new Uint8Array(await crypto.subtle.exportKey('raw', mk));
                const ciphertext = new Uint8Array(
                    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawMK)
                );
                return { ciphertext, iv };
            });

            // 3. Create recovery data
            const data = await createRecoveryData(masterKey);
            expect(data.recoveryCode.fullCode).toHaveLength(RECOVERY_CODE_LENGTH);

            // 4. Recover master key
            const recoveredKey = await recoverMasterKey(
                data.recoveryCode.fullCode,
                data.encryptedRecoveryMasterKey,
                data.encryptedRecoveryMasterKeyIV
            );

            // 5. Verify the recovered key can decrypt something encrypted by the original
            const testData = new TextEncoder().encode('secret message');
            const testIv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: testIv },
                masterKey,
                testData
            );

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: testIv },
                recoveredKey,
                ciphertext
            );

            expect(new TextDecoder().decode(decrypted)).toBe('secret message');
        });
    });
});
