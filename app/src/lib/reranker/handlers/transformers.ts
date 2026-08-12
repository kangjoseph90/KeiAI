/**
 * Transformers Reranker Handler — KeiAI
 *
 * Implements RerankerHandler with a local cross-encoder model.
 * Scores each query-document pair and sorts by relevance.
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
                device: 'wasm',
                signal
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
