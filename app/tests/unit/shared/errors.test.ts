import { describe, it, expect } from 'vitest';
import { AppError, getErrorMessage, isErrorCode } from '$lib/shared/errors';

describe('Shared Errors', () => {
	describe('AppError', () => {
		it('should create an error with code, message, and name', () => {
			const error = new AppError('NOT_FOUND', 'Item not found');

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe('AppError');
			expect(error.code).toBe('NOT_FOUND');
			expect(error.message).toBe('Item not found');
			expect(error.cause).toBeUndefined();
		});

		it('should store the cause if provided', () => {
			const cause = new Error('Original error');
			const error = new AppError('NETWORK_ERROR', 'Network failed', cause);

			expect(error.cause).toBe(cause);
		});
	});

	describe('getErrorMessage', () => {
		it('should return the message from an AppError', () => {
			const error = new AppError('NOT_FOUND', 'AppError message');
			expect(getErrorMessage(error)).toBe('AppError message');
		});

		it('should return the message from a standard Error', () => {
			const error = new Error('Standard error message');
			expect(getErrorMessage(error)).toBe('Standard error message');
		});

		it('should return the default message for a string', () => {
			expect(getErrorMessage('Just a string error')).toBe('An error occurred');
		});

		it('should return the default message for null', () => {
			expect(getErrorMessage(null)).toBe('An error occurred');
		});

		it('should return the default message for undefined', () => {
			expect(getErrorMessage(undefined)).toBe('An error occurred');
		});

		it('should return the default message for an object without a message property', () => {
			expect(getErrorMessage({ status: 500 })).toBe('An error occurred');
		});

		it('should use a custom default message if provided when error is unknown', () => {
			expect(getErrorMessage(null, 'Custom fallback error')).toBe('Custom fallback error');
		});
	});

	describe('isErrorCode', () => {
		it('should return true if error is AppError and code matches', () => {
			const error = new AppError('INVALID_INPUT', 'Bad input');
			expect(isErrorCode(error, 'INVALID_INPUT')).toBe(true);
		});

		it('should return false if error is AppError but code does not match', () => {
			const error = new AppError('NETWORK_ERROR', 'Network issue');
			expect(isErrorCode(error, 'INVALID_INPUT')).toBe(false);
		});

		it('should return false if error is not an AppError', () => {
			const error = new Error('Standard error');
			expect(isErrorCode(error, 'INVALID_INPUT')).toBe(false);
		});

		it('should return false for null, undefined, or other non-error values', () => {
			expect(isErrorCode(null, 'INVALID_INPUT')).toBe(false);
			expect(isErrorCode(undefined, 'INVALID_INPUT')).toBe(false);
			expect(isErrorCode('string error', 'INVALID_INPUT')).toBe(false);
		});
	});
});
