/**
 * Tauri Tokenizer Adapter — KeiAI
 *
 * Native Rust tokenizer implementation using tiktoken-rs.
 *
 * TODO: Implement native Rust tokenizer via Tauri command.
 * Future implementation would use invoke() to call Rust backend:
 *
 * ```rust
 * // src-tauri/src/tokenizer.rs
 * #[tauri::command]
 * async fn tokenize(text: String, model: String) -> Result<usize, String> {
 *     let encoding = get_encoding(&model)?;
 *     Ok(encoding.encode(text).len())
 * }
 * ```
 *
 * ```typescript
 * // In this file
 * import { invoke } from '@tauri-apps/api/core';
 * const count = await invoke('tokenize', { text, model });
 * ```
 *
 * Note: Caching is handled at this layer (not in Rust) to share the
 * cache implementation with the Web adapter.
 */

import type { ITokenizerAdapter, ModelType } from './types';
import { AppError } from '$lib/shared/errors';
import { LRUCache } from '$lib/shared/cache';

// ─── Cache ───────────────────────────────────────────────────────────────────

/** LRU cache for token counts. Key: `${model}:${text}`, Value: token count */
const cache = new LRUCache<string, number>(500);

// ─── Tauri Tokenizer Adapter ─────────────────────────────────────────────────

export class TauriTokenizerAdapter implements ITokenizerAdapter {
	async count(text: string, model: ModelType): Promise<number> {
		// Generate cache key
		const cacheKey = `${model}:${text}`;

		// Check cache first
		const cached = cache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		// TODO: Replace with native Rust implementation
		// const result = await invoke('tokenize', { text, model });
		throw new AppError(
			'NOT_IMPLEMENTED',
			'Native tokenizer not yet implemented for Tauri. Please use the web implementation or implement the Rust backend.'
		);

		// When implemented:
		// cache.set(cacheKey, result);
		// return result;
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

export const tauriTokenizer = new TauriTokenizerAdapter();
