/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All handlers (Mock, OpenAI, Claude, …) implement LLMStreamHandler.
 */

import type { ToolCallRequest } from '$lib/services/content/tool';
import type { RetryOptions } from '$lib/adapters/http/types';
import type { LLMFlags, LLMParameter } from '$lib/types/models/llm';
import type { StreamDebounceConfig } from '$lib/utils/stream';
import type { LLMRole } from '$lib/types/models/llm';

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
    role: LLMRole;
    content: string;
    thought?: string;
}

/**
 * Base configuration shared by ALL LLM stream handlers.
 * Contains only generation-related concerns.
 */
export interface LLMStreamHandlerConfig {
    modelId: string;
    flags?: LLMFlags[];
    parameters?: Partial<Record<LLMParameter, number | string | boolean>>;
    debounce?: StreamDebounceConfig;
}

/**
 * Extended configuration for remote (HTTP-based) LLM stream handlers.
 * Adds transport fields on top of the base generation config.
 */
export interface RemoteLLMHandlerConfig extends LLMStreamHandlerConfig {
    baseUrl: string;
    apiKey?: string;
    useProxy?: boolean;
    retry?: RetryOptions;
    timeout?: number;
}
