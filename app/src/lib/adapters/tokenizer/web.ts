/**
 * Web Tokenizer Adapter — KeiAI
 *
 * Web implementation using Comlink to communicate with a Worker.
 * Tokenization runs in a separate thread to avoid blocking the UI.
 * Caching is handled at this layer to share cache implementation with Tauri.
 */

import type { ITokenizerAdapter, ModelType } from './types';
import { wrap, type Remote } from 'comlink';
import { AppError } from '$lib/shared/errors';
import { LRUCache } from '$lib/shared/cache';

// ─── Worker Type ────────────────────────────────────────────────────────────

/** Interface matching the TokenizerWorker class exposed in worker.ts */
interface TokenizerWorker {
	count(text: string, model: ModelType): number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

/** LRU cache for token counts. Key: `${model}:${text}`, Value: token count */
const cache = new LRUCache<string, number>(500);

// ─── Worker Singleton ───────────────────────────────────────────────────────

let workerInstance: Remote<TokenizerWorker> | null = null;

function getWorker(): Remote<TokenizerWorker> {
	if (workerInstance) {
		return workerInstance;
	}

	try {
		const worker = new Worker(new URL('./worker.ts', import.meta.url), {
			type: 'module'
		});

		workerInstance = wrap<TokenizerWorker>(worker);
		return workerInstance;
	} catch (error) {
		throw new AppError(
			'TOKENIZER_ERROR',
			'Failed to initialize tokenizer worker',
			error
		);
	}
}

// ─── Web Tokenizer Adapter ──────────────────────────────────────────────────

export class WebTokenizerAdapter implements ITokenizerAdapter {
	async count(text: string, model: ModelType): Promise<number> {
		// Generate cache key
		const cacheKey = `${model}:${text}`;

		// Check cache first
		const cached = cache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		// Delegate to worker for computation
		try {
			const worker = getWorker();
			const result = await worker.count(text, model);

			// Cache the result
			cache.set(cacheKey, result);
			return result;
		} catch (error) {
			if (error instanceof AppError) throw error;

			throw new AppError(
				'TOKENIZER_ERROR',
				`Failed to count tokens: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	/**
	 * Clear the token cache.
	 */
	clearCache(): void {
		cache.clear();
	}

	/**
	 * Get current cache size (number of entries).
	 */
	getCacheSize(): number {
		return cache.size;
	}
}

export const webTokenizer = new WebTokenizerAdapter();
