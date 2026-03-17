/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All providers (Mock, OpenAI, Claude, …) implement StreamProvider.
 */

import type { ToolCallRequest } from '$lib/services/content/tool';
import type { RetryOptions } from '$lib/adapters/http/types';
import type { LLMFlags, Parameter } from '$lib/types/models';

// ─── Stream Content ──────────────────────────────────────────────────────────

/**
 * Abstract streaming interface for any LLM source.
 *
 * The provider owns chunk debouncing/batching.
 * CONTRACT: Yields cumulative content (e.g. "1", "12", "123")
 * instead of individual chunks.
 */
export type StreamContent = {
	content: string;
	thought?: string;
	toolCalls?: ToolCallRequest[];
};

export interface StreamProvider {
	stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<StreamContent>;
}

// ─── Chat Message ────────────────────────────────────────────────────────────

/** OpenAI-compatible chat message type */
export interface OpenAIChat {
	role: 'system' | 'user' | 'assistant';
	content: string;
	thought?: string;
}

// ─── Provider Config (Role-Based) ────────────────────────────────────────────

/** Model identity & generation parameters */
export interface StreamModelConfig {
	modelId: string;
	flags?: LLMFlags[];
	parameters?: Partial<Record<Parameter, number | string | boolean>>;
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
export interface StreamHttpConfig {
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
