/**
 * Token Counter — KeiAI
 *
 * LLM utility for token counting with LRU caching.
 * Delegates pure computation to the adapter layer.
 */

import { appTokenizer } from '$lib/adapters/tokenizer';
import { LRUCache } from '$lib/utils/cache';
import type { TokenizerEncoding } from '$lib/types/models';

// ─── Cache ───────────────────────────────────────────────────────────────────

/** LRU cache for token counts. Key: `${encoding}:${text}`, Value: token count */
const tokenCache = new LRUCache<string, number>(500);

// ─── Token Counter ───────────────────────────────────────────────────────────

export class TokenCounter {
	/**
	 * Count the number of tokens in the given text for the specified encoding.
	 * Results are cached for performance.
	 */
	static async count(text: string, encoding: TokenizerEncoding): Promise<number> {
		const cacheKey = `${encoding}:${text}`;

		const cached = tokenCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		const result = await appTokenizer.count(text, encoding);

		tokenCache.set(cacheKey, result);
		return result;
	}

	static clearCache(): void {
		tokenCache.clear();
	}

	static getCacheSize(): number {
		return tokenCache.size;
	}
}
