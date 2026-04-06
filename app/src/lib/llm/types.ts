/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All handlers (Mock, OpenAI, Claude, …) implement LLMStreamHandler.
 */

import type { ToolCallRequest } from '$lib/services/content/tool';
import type { RetryOptions } from '$lib/adapters/http/types';
import type { LLMFlags, LLMParameter } from '$lib/types/models/llm';

// ─── Stream Content ──────────────────────────────────────────────────────────

/**
 * Abstract streaming interface (LLMHandler) for any LLM source.
 *
 * The handler owns chunk debouncing/batching.
 * CONTRACT: Yields cumulative content (e.g. "1", "12", "123")
 * instead of individual chunks.
 */
export type LLMStreamContent = {
	content: string;
	thought?: string;
	toolCalls?: ToolCallRequest[];
};

export interface LLMStreamHandler {
	stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<LLMStreamContent>;
}

// ─── Chat Message ────────────────────────────────────────────────────────────

/** OpenAI-compatible chat message type */
export interface OpenAIChat {
	role: 'system' | 'user' | 'assistant';
	content: string;
	thought?: string;
}

// ─── Handler Config (Role-Based) ────────────────────────────────────────────

/** Model identity & generation parameters */
export interface LLMStreamModelConfig {
	modelId: string;
	flags?: LLMFlags[];
	parameters?: Partial<Record<LLMParameter, number | string | boolean>>;
}

/**
 * HTTP transport: auth, endpoint, proxy, retry.
 *
 * NOTE: `apiKey` assumes Bearer token auth (OpenAI, DeepSeek, Mistral, etc.).
 * When adding OAuth2 (Vertex AI), Azure AD, or SigV4 (Bedrock), replace
 * `apiKey` with a discriminated union:
 *   type AuthConfig =
 *     | { type: 'bearer'; token: string }
 *     | { type: 'header'; headers: Record<string, string> }
 */
export interface LLMStreamHttpConfig {
	apiKey: string;
	/** Base URL without trailing slash (e.g. "https://api.openai.com/v1") */
	baseUrl: string;
	/** Use proxy adapter for CORS bypass (Web only). Default: true */
	useProxy?: boolean;
	/** Retry options for transient failures */
	retry?: RetryOptions;
	/** Request timeout in ms */
	timeout?: number;
}
