export type ErrorCode =
	| 'NOT_FOUND'
	| 'OWNERSHIP_VIOLATION'
	| 'ENCRYPTION_FAILED'
	| 'DB_WRITE_FAILED'
	| 'SESSION_EXPIRED';

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
