/**
 * Cohere Reranker Handler — KeiAI
 *
 * Implements RerankerHandler for Cohere's /v1/rerank endpoint.
 */

import type { RerankerResult, RerankerHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CohereRerankerConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    /** Max number of results to return */
    topN?: number;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class CohereRerankerHandler implements RerankerHandler {
    private readonly config: CohereRerankerConfig;

    constructor(config: CohereRerankerConfig) {
        this.config = config;
    }

    async rerank(
        query: string,
        documents: string[],
        signal?: AbortSignal
    ): Promise<RerankerResult> {
        if (documents.length === 0) return { results: [] };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(buildUrl(this.config.baseUrl, '/v1/rerank'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.modelId,
                query,
                documents,
                top_n: this.config.topN ?? documents.length
            }),
            signal
        });

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `Cohere Reranker failed: ${response.status}`);
        }

        const json = await response.json();
        const results = json.results.map(
            (r: { index: number; relevance_score: number; document?: { text: string } }) => ({
                index: r.index,
                score: r.relevance_score,
                text: r.document?.text
            })
        );

        return { results };
    }
}
