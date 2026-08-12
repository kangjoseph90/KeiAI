/**
 * Embedding Types — KeiAI
 *
 * Shared interfaces for the embedding adapter layer.
 * Unlike LLM/TTS, embedding is non-streaming: returns vectors in one shot.
 */

export interface EmbeddingResult {
    vectors: Float32Array[];
}

export interface DocumentEmbeddingResult {
    /** Vectors grouped to mirror the input documents and their chunks. */
    vectors: Float32Array[][];
}

export interface EmbeddingHandler {
    embedQuery(queries: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
    /** Each inner array contains ordered chunks from one source document. */
    embedDocuments(documents: string[][], signal?: AbortSignal): Promise<DocumentEmbeddingResult>;
}

export interface SelectedEmbeddingHandler {
    /** Provider-qualified model identity used by callers for cache isolation. */
    modelId: string;
    handler: EmbeddingHandler;
}
