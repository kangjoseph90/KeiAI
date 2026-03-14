/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All providers (Mock, OpenAI, Claude, …) implement StreamProvider.
 */

import type { ToolCallRequest } from '$lib/services/content/tool';
import type { OpenAIChat } from '$lib/runtime/prompt/types';

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
