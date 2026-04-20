/**
 * Reranker Types — KeiAI
 *
 * Shared interfaces for the reranking adapter layer.
 * Non-streaming: returns ranked results in one shot.
 */

export interface RerankerItem {
    /** Original index of the document in the input array */
    index: number;
    /** Relevance score (higher = more relevant) */
    score: number;
    /** Original document text (returned by some providers) */
    text?: string;
}

export interface RerankerResult {
    results: RerankerItem[];
}

export interface RerankerHandler {
    rerank(query: string, documents: string[], signal?: AbortSignal): Promise<RerankerResult>;
}
