import type { RetryOptions } from './types';

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

// ─── Retry Helper ────────────────────────────────────────────────────

/**
 * Wraps a fetch call with exponential backoff retry.
 *
 * - Retries on network errors and retryable HTTP status codes.
 * - Immediately rethrows AbortError (user-cancelled requests).
 * - Jittered delay: `baseDelay * 2^attempt * random(0.75–1.25)`, capped at `maxDelayMs`.
 */
export async function fetchWithRetry(
	fn: () => Promise<Response>,
	options?: RetryOptions
): Promise<Response> {
	const {
		maxRetries = 0,
		baseDelayMs = 1000,
		maxDelayMs = 30_000,
		retryableStatuses = DEFAULT_RETRYABLE_STATUSES
	} = options ?? {};

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await fn();

			// Non-retryable status or success → return immediately
			if (response.ok || !retryableStatuses.includes(response.status)) {
				return response;
			}

			// Retryable HTTP status — treat as error for retry loop
			lastError = response;
		} catch (error) {
			// Never retry user-initiated aborts
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			lastError = error;
		}

		// Wait before next attempt (skip wait on last attempt)
		if (attempt < maxRetries) {
			const jitter = Math.random() * 0.5 + 0.75; // 0.75 – 1.25
			const delay = Math.min(baseDelayMs * 2 ** attempt * jitter, maxDelayMs);
			await new Promise((r) => setTimeout(r, delay));
		}
	}

	// All retries exhausted — throw last error
	throw lastError;
}
