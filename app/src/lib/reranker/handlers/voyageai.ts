/**
 * VoyageAI Reranker Handler — KeiAI
 *
 * Implements RerankerHandler for Voyage AI's /v1/rerank endpoint.
 */

import type { RankedResult, RerankerHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface VoyageAIRerankerConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    topK?: number;
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class VoyageAIRerankerHandler implements RerankerHandler {
    private readonly config: VoyageAIRerankerConfig;

    constructor(config: VoyageAIRerankerConfig) {
        this.config = config;
    }

    async rerank(query: string, documents: string[], signal: AbortSignal): Promise<RankedResult[]> {
        if (documents.length === 0) return [];

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/v1/rerank'),
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: this.config.modelId,
                    query,
                    documents,
                    top_k: this.config.topK ?? documents.length
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `VoyageAI Reranker failed: ${response.status}`);
        }

        const json = await response.json();
        return json.data.map((r: { index: number; relevance_score: number }) => ({
            index: r.index,
            score: r.relevance_score
        }));
    }
}
