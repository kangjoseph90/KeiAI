/**
 * Embedding Types — KeiAI
 *
 * Shared interfaces for the embedding adapter layer.
 * Unlike LLM/TTS, embedding is non-streaming: returns vectors in one shot.
 */

export interface EmbeddingResult {
    /** One embedding vector per input text */
    vectors: Float32Array[];
}

export interface EmbeddingHandler {
    embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
}

export interface SelectedEmbeddingHandler {
    /** Provider-qualified model identity used by callers for cache isolation. */
    modelId: string;
    handler: EmbeddingHandler;
}
