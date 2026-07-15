/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All handlers (Mock, OpenAI, Claude, …) implement LLMStreamHandler.
 */

import type { ToolCallRequest } from '$lib/services/content/tool';
import type { RetryOptions } from '$lib/adapters/http/types';
import type { LLMParameters, LLMRole } from '$lib/types/models/llm';

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
    stream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options?: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent>;
}

// ─── Chat Message ────────────────────────────────────────────────────────────

export type LLMContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string };

/** Returns only the text portions of a multimodal message. */
export function getTextContent(content: LLMContentPart[]): string {
    return content
        .filter((part): part is Extract<LLMContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

/** Provider-neutral multimodal message used throughout the app. */
export interface LLMMessage {
    role: LLMRole;
    content: LLMContentPart[];
}

/**
 * Base configuration shared by ALL LLM stream handlers.
 * Contains only generation-related concerns.
 */
export interface LLMStreamHandlerConfig {
    modelId: string;
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

export interface PluginLLMHandlerConfig extends LLMStreamHandlerConfig {
    useProxy?: boolean;
    retry?: RetryOptions;
    timeout?: number;
}

export interface LLMStreamOptions {
    parameters?: LLMParameters;
    maxResponse?: number;
    stream?: boolean;
}
