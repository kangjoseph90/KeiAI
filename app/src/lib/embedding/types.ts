/**
 * Embedding Types — KeiAI
 *
 * Shared interfaces for the embedding adapter layer.
 * Unlike LLM/TTS, embedding is non-streaming: returns vectors in one shot.
 */

export interface EmbeddingResult {
	/** One embedding vector per input text */
	vectors: number[][];
}

export interface EmbeddingStreamProvider {
	embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
}
