/**
 * Tokenizer Adapter — KeiAI
 *
 * Platform-adaptive tokenizer for counting LLM tokens.
 * Web: Uses Comlink Worker with @mlc-ai/web-tokenizers
 * Tauri: Native Rust (tiktoken-rs + HuggingFace tokenizers)
 */

export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { webTokenizer } from './web';
import { tauriTokenizer } from './tauri';

/**
 * The tokenizer adapter instance.
 * Dispatches to the appropriate implementation based on platform.
 */
export const appTokenizer = isTauri() ? tauriTokenizer : webTokenizer;
