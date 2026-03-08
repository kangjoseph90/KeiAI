/**
 * Tokenizer Adapter Types — KeiAI
 *
 * Interface for token counting across different LLM models.
 * Maps model names to tiktoken encodings.
 */

/**
 * Supported model types.
 * Can be specific model names (for encodingForModel lookup)
 * or direct encoding names (for getEncoding).
 */
export type ModelType =
	// OpenAI models (uses encodingForModel)
	| 'gpt-4'
	| 'gpt-4o'
	| 'gpt-4o-mini'
	| 'gpt-3.5-turbo'
	// Direct encoding names
	| 'o200k_base' // GPT-4o, o1 series
	| 'cl100k_base' // GPT-4, GPT-3.5-turbo, Claude-compatible
	| 'p50k_base' // Code models, text-davinci-002
	| 'r50k_base' // Older GPT-3 models
	| 'p50k_edit' // Edit models
	| 'gpt2'; // Original GPT-2

/**
 * Tokenizer Adapter Interface
 *
 * Provides pure token counting computation for text.
 * No caching - caching is handled by the Service layer.
 *
 * Web implementation uses a Worker with js-tiktoken.
 * Tauri implementation (future) will use native Rust tokenizer.
 */
export interface ITokenizerAdapter {
	/**
	 * Count the number of tokens in the given text for the specified model.
	 * Pure computation - no caching.
	 *
	 * @param text - The text to tokenize
	 * @param model - The model type or encoding name
	 * @returns Promise<number> - The token count
	 */
	count(text: string, model: ModelType): Promise<number>;
}
