/**
 * Reranker Types — KeiAI
 *
 * Shared interfaces for the reranking adapter layer.
 * Non-streaming: returns ranked results in one shot.
 */

export interface RankedResult {
    index: number;
    score: number;
}

export interface RerankerHandler {
    rerank(query: string, documents: string[], signal: AbortSignal): Promise<RankedResult[]>;
}
