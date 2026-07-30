/**
 * Transformers Reranker Handler — KeiAI
 *
 * Implements RerankerHandler using local embedding + cosine similarity.
 * Bi-encoder approach: embed query and documents separately, then rank by similarity.
 * Less accurate than cross-encoder but works with any embedding model.
 */

import { transformers } from '$lib/inference';
import type { RankedResult, RerankerHandler } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface TransformersRerankerConfig {
    modelId: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class TransformersRerankerHandler implements RerankerHandler {
    private readonly config: TransformersRerankerConfig;

    constructor(config: TransformersRerankerConfig) {
        this.config = config;
    }

    async rerank(query: string, documents: string[], signal: AbortSignal): Promise<RankedResult[]> {
        if (documents.length === 0) return [];
        signal.throwIfAborted();

        const scores = await transformers.rerank(
            { modelId: this.config.modelId },
            query,
            documents,
            {
                device: 'wasm'
            }
        );
        signal.throwIfAborted();

        const results: RankedResult[] = scores.map((score, index) => ({
            index,
            score
        }));

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        return results;
    }
}
