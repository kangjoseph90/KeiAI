import { describe, it, expect } from 'vitest';
import { splitRecoveryCode } from '../recovery.js';
import { RECOVERY_CODE_LENGTH, RECOVERY_FRONT_LENGTH } from '../constants.js';

describe('splitRecoveryCode', () => {
	it('should successfully split a valid recovery code into two halves', () => {
		const validCode = '1234567890ABCDEF';
		expect(validCode.length).toBe(RECOVERY_CODE_LENGTH);

		const parts = splitRecoveryCode(validCode);

		expect(parts).toEqual({
			fullCode: validCode,
			frontHalf: validCode.slice(0, RECOVERY_FRONT_LENGTH),
			backHalf: validCode.slice(RECOVERY_FRONT_LENGTH)
		});

		expect(parts.frontHalf.length).toBe(RECOVERY_FRONT_LENGTH);
		expect(parts.backHalf.length).toBe(RECOVERY_CODE_LENGTH - RECOVERY_FRONT_LENGTH);
	});

	it('should throw an error if the recovery code is too short', () => {
		const shortCode = '1234567890ABCDE';
		expect(shortCode.length).toBeLessThan(RECOVERY_CODE_LENGTH);

		expect(() => splitRecoveryCode(shortCode)).toThrowError(
			`Recovery code must be exactly ${RECOVERY_CODE_LENGTH} characters`
		);
	});

	it('should throw an error if the recovery code is too long', () => {
		const longCode = '1234567890ABCDEFG';
		expect(longCode.length).toBeGreaterThan(RECOVERY_CODE_LENGTH);

		expect(() => splitRecoveryCode(longCode)).toThrowError(
			`Recovery code must be exactly ${RECOVERY_CODE_LENGTH} characters`
		);
	});
});
