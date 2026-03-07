export type ErrorCode =
	| 'NOT_FOUND'
	| 'OWNERSHIP_VIOLATION'
	| 'ENCRYPTION_FAILED'
	| 'DB_WRITE_FAILED'
	| 'SESSION_EXPIRED'
	| 'NOT_AUTHENTICATED'
	| 'INVALID_CREDENTIALS'
	| 'ALREADY_REGISTERED'
	| 'INVALID_INPUT'
	| 'NETWORK_ERROR'
	| 'STORAGE_ERROR';

export class AppError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'AppError';
	}
}

/**
 * Convert error to message for UI display.
 * Falls back to the original message for unknown error types.
 */
export function getErrorMessage(error: unknown, defaultMessage = 'An error occurred'): string {
	if (error instanceof AppError) {
		return error.message; // AppError messages are already user-facing
	}
	if (error instanceof Error) {
		return error.message;
	}
	return defaultMessage;
}

/**
 * Check if an error is an AppError with a specific code.
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
	return error instanceof AppError && error.code === code;
}
