/**
 * LLM Adapter Types — KeiAI
 *
 * Shared interfaces for the LLM adapter layer.
 * All providers (Mock, OpenAI, Claude, …) implement StreamProvider.
 */

/**
 * Abstract streaming interface for any LLM source.
 *
 * The provider owns chunk debouncing/batching — the pipeline
 * processes every yielded chunk as-is.
 * Must respect AbortSignal for user-initiated cancellation.
 */
export interface StreamProvider {
	stream(signal: AbortSignal): AsyncIterable<string>;
}
