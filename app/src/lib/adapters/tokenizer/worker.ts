/**
 * Tokenizer Worker — KeiAI
 *
 * Web Worker that performs tokenization using js-tiktoken.
 * Runs in a separate thread to avoid blocking the main thread.
 * Exposed via Comlink for seamless async communication.
 *
 * This worker handles pure tokenization only - no caching.
 * Caching is handled by the adapter layer (web.ts, tauri.ts) to share
 * the cache implementation across platforms.
 */

import { expose } from 'comlink';
import { encodingForModel, getEncoding, type TiktokenModel, type TiktokenEncoding } from 'js-tiktoken';
import type { ModelType } from './types';

// ─── Encoder Cache ───────────────────────────────────────────────────────────

/**
 * Encoder instance cache - reuse encoders to avoid re-initialization overhead.
 * This is worker-local since encoder instances are not transferable.
 */
const encoderCache = new Map<string, ReturnType<typeof getEncoding>>();

function getEncoder(model: ModelType): ReturnType<typeof getEncoding> {
	const cacheKey = model;

	if (encoderCache.has(cacheKey)) {
		return encoderCache.get(cacheKey)!;
	}

	let encoder: ReturnType<typeof getEncoding>;

	// Try to use encodingForModel for known OpenAI models
	try {
		encoder = encodingForModel(model as TiktokenModel);
	} catch {
		// Fall back to direct encoding name
		encoder = getEncoding(model as TiktokenEncoding);
	}

	encoderCache.set(cacheKey, encoder);
	return encoder;
}

// ─── Tokenizer Worker Class ──────────────────────────────────────────────────

class TokenizerWorker {
	/**
	 * Count tokens in text for the given model.
	 * Pure computation - no caching (handled by adapter layer).
	 */
	count(text: string, model: ModelType): number {
		const encoder = getEncoder(model);
		const tokens = encoder.encode(text);
		return tokens.length;
	}
}

// ─── Expose via Comlink ─────────────────────────────────────────────────────

expose(new TokenizerWorker());
