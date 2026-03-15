/**
 * Web Tokenizer Adapter — KeiAI
 *
 * Web implementation using Comlink to communicate with a Worker.
 * Tokenization runs in a separate thread to avoid blocking the UI.
 * Pure computation - no caching (handled by Service layer).
 */

import type { ITokenizerAdapter } from './types';
import type { TokenizerEncoding } from '$lib/types/models';
import { wrap, type Remote } from 'comlink';
import { AppError } from '$lib/types/errors';

// ─── Worker Type ────────────────────────────────────────────────────────────

/** Interface matching the TokenizerWorker class exposed in worker.ts */
interface TokenizerWorker {
	count(text: string, encoding: TokenizerEncoding): Promise<number>;
}

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
		throw new AppError('TOKENIZER_ERROR', 'Failed to initialize tokenizer worker', error);
	}
}

// ─── Web Tokenizer Adapter ──────────────────────────────────────────────────

export class WebTokenizerAdapter implements ITokenizerAdapter {
	async count(text: string, encoding: TokenizerEncoding): Promise<number> {
		try {
			const worker = getWorker();
			return await worker.count(text, encoding);
		} catch (error) {
			if (error instanceof AppError) throw error;

			throw new AppError(
				'TOKENIZER_ERROR',
				`Failed to count tokens: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}
}

export const webTokenizer = new WebTokenizerAdapter();
