/**
 * Tokenizer Service — KeiAI
 *
 * Service layer for token counting with caching.
 * Delegates pure computation to the adapter layer.
 */

import { appTokenizer } from '$lib/adapters/tokenizer';
import { LRUCache } from '$lib/shared/cache';
import type { ModelType } from '$lib/adapters/tokenizer';

// ─── Cache ───────────────────────────────────────────────────────────────────

/** LRU cache for token counts. Key: `${model}:${text}`, Value: token count */
const tokenCache = new LRUCache<string, number>(500);

// ─── Tokenizer Service ───────────────────────────────────────────────────────

export class TokenizerService {
	/**
	 * Count the number of tokens in the given text for the specified model.
	 * Results are cached for performance.
	 *
	 * @param text - The text to tokenize
	 * @param model - The model type or encoding name
	 * @returns Promise<number> - The token count
	 */
	static async count(text: string, model: ModelType): Promise<number> {
		// Generate cache key
		const cacheKey = `${model}:${text}`;

		// Check cache first
		const cached = tokenCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		// Delegate to adapter for pure computation
		const result = await appTokenizer.count(text, model);

		// Cache the result
		tokenCache.set(cacheKey, result);
		return result;
	}

	/**
	 * Clear the token cache.
	 */
	static clearCache(): void {
		tokenCache.clear();
	}

	/**
	 * Get current cache size (number of entries).
	 */
	static getCacheSize(): number {
		return tokenCache.size;
	}
}
