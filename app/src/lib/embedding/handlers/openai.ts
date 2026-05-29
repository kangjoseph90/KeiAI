/**
 * OpenAI Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler for OpenAI's /embeddings endpoint.
 * Also covers any OpenAI-compatible embedding API.
 */

import type { EmbeddingResult, EmbeddingHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAIEmbeddingHandler implements EmbeddingHandler {
    private readonly config: OpenAIEmbeddingConfig;

    constructor(config: OpenAIEmbeddingConfig) {
        this.config = config;
    }

    async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(buildUrl(this.config.baseUrl, '/embeddings'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.modelId,
                input: texts
            }),
            signal
        });

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `OpenAI Embedding failed: ${response.status}`);
        }

        const json = await response.json();
        const vectors = json.data
            .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
            .map((d: { embedding: number[] }) => d.embedding);

        return { vectors };
    }
}
