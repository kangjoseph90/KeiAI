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
 * Note: Caching is handled by the Service layer, not here.
 */

import type { ITokenizerAdapter, ModelType } from './types';
import { AppError } from '$lib/shared/errors';

export class TauriTokenizerAdapter implements ITokenizerAdapter {
	async count(text: string, model: ModelType): Promise<number> {
		// TODO: Replace with native Rust implementation
		// const result = await invoke('tokenize', { text, model });
		throw new AppError(
			'NOT_IMPLEMENTED',
			'Native tokenizer not yet implemented for Tauri. Please use the web implementation or implement the Rust backend.'
		);
	}
}

export const tauriTokenizer = new TauriTokenizerAdapter();
