/**
 * Model & Tokenizer Definitions — KeiAI
 *
 * Shared vocabulary for model metadata, tokenizer types, and API formats.
 * Referenced by adapters (tokenizer), llm (provider/prompt), and UI (model selector).
 */

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/** Supported tokenizer encodings. Each maps to a concrete tokenizer implementation. */
export type TokenizerEncoding =
	| 'o200k_base' // OpenAI (GPT-4o, o1, o3)
	| 'claude' // Anthropic (Claude 3.5/4)
	| 'llama3' // Meta (Llama 3/4) + most open-source derivatives
	| 'deepseek' // DeepSeek (V3, R1)
	| 'gemma' // Google (Gemini 1.5/2.0/2.5)
	| 'mistral'; // Mistral (Large, Codestral)
