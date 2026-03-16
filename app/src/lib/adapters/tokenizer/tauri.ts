/**
 * Tauri Tokenizer Adapter — KeiAI
 *
 * Native Rust tokenizer via Tauri IPC.
 * Uses tiktoken-rs (WASM-free) for OpenAI and HuggingFace tokenizers for the rest.
 * 10-30x faster than the Web Worker implementation.
 */

import type { ITokenizerAdapter } from './types';
import type { LLMTokenizer } from '$lib/types/models';
import { invoke } from '@tauri-apps/api/core';
import { AppError } from '$lib/types/errors';

export class TauriTokenizerAdapter implements ITokenizerAdapter {
	async count(text: string, encoding: LLMTokenizer): Promise<number> {
		try {
			return await invoke<number>('count_tokens', { text, encoding });
		} catch (error) {
			throw new AppError(
				'TOKENIZER_ERROR',
				`Native tokenizer failed: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}
}

export const tauriTokenizer = new TauriTokenizerAdapter();
