// ─── OpenAI ──────────────────────────────────────────────────────────────────

import type { CustomLLMModel } from './llm';

export interface OpenAIProviderConfig {
	apiKey?: string;
	tts: {
		modelId: string;
		voiceId: string;
	};
	embedding: {
		modelId: string;
	};
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

export interface AnthropicProviderConfig {
	apiKey?: string;
}

// ─── Google ───────────────────────────────────────────────────────────────────

export interface GoogleProviderConfig {
	apiKey?: string;
	tts: {
		modelId: string;
		voiceId: string;
	};
	embedding: {
		modelId: string;
	};
}

// ─── Mistral ──────────────────────────────────────────────────────────────────

export interface MistralProviderConfig {
	apiKey?: string;
}

// ─── DeepSeek ─────────────────────────────────────────────────────────────────

export interface DeepSeekProviderConfig {
	apiKey?: string;
}

// ─── NovelAI ─────────────────────────────────────────────────────────────────

export interface NovelAIProviderConfig {
	apiKey?: string;
	tts: {
		voiceId: string;
		version: string;
	};
}

// ─── VoyageAI ─────────────────────────────────────────────────────────────────

export interface VoyageAIProviderConfig {
	apiKey?: string;
	embedding: {
		modelId: string;
	};
}

// ─── ElevenLabs ─────────────────────────────────────────────────────────────

export interface ElevenLabsProviderConfig {
	apiKey?: string;
	tts: {
		voiceId: string;
	};
}

// ─── Kokoro ─────────────────────────────────────────────────────────────────

export interface KokoroProviderConfig {
	tts: {
		voiceId: string;
	};
}

// ─── MiniLM ─────────────────────────────────────────────────────────────────

export interface MiniLMProviderConfig {
	embedding: {
		modelId: string;
	};
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────

export interface OpenRouterProviderConfig {
	apiKey?: string;
	embedding: {
		modelId: string;
	};
}

// ─── Transformers ───────────────────────────────────────────────────────────

export interface TransformersProviderConfig {
	embedding: {
		modelId: string;
	};
	tts: {
		modelId: string;
		voiceId: string;
	};
}

// ─── Custom ─────────────────────────────────────────────────────────────────

export interface CustomProviderConfig {
	llm: {
		models: CustomLLMModel[];
	};
	// tts: {} - onnx runtime model
	embedding: {
		// openai compatible
		modelId: string;
		baseUrl: string;
		apiKey?: string;
	};
}
