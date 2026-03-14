/**
 * Tokenizer Adapter Types — KeiAI
 *
 * Interface for token counting across different LLM models.
 */

import type { TokenizerEncoding } from '$lib/shared/models';

/**
 * Tokenizer Adapter Interface
 *
 * Provides pure token counting computation for text.
 * No caching - caching is handled by the llm/tokenizer layer.
 *
 * Web implementation uses a Worker with @mlc-ai/web-tokenizers.
 * Tauri implementation uses native Rust (tiktoken-rs + HuggingFace tokenizers).
 */
export interface ITokenizerAdapter {
	/**
	 * Count the number of tokens in the given text for the specified encoding.
	 * Pure computation - no caching.
	 *
	 * @param text - The text to tokenize
	 * @param encoding - The tokenizer encoding to use
	 * @returns Promise<number> - The token count
	 */
	count(text: string, encoding: TokenizerEncoding): Promise<number>;
}
