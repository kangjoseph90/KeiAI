/**
 * OpenAI Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler for OpenAI's /embeddings endpoint.
 * Also covers any OpenAI-compatible embedding API.
 */

import type { DocumentEmbeddingResult, EmbeddingResult, EmbeddingHandler } from '../types';
import { groupEmbeddingVectors } from '../grouping';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAIEmbeddingHandler implements EmbeddingHandler {
    private readonly config: OpenAIEmbeddingConfig;

    constructor(config: OpenAIEmbeddingConfig) {
        this.config = config;
    }

    embedQuery(queries: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        return this.embed(queries, signal);
    }

    async embedDocuments(
        documents: string[][],
        signal?: AbortSignal
    ): Promise<DocumentEmbeddingResult> {
        const groupSizes = documents.map((document) => document.length);
        const { vectors } = await this.embed(documents.flat(), signal);
        return { vectors: groupEmbeddingVectors(vectors, groupSizes) };
    }

    private async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        signal?.throwIfAborted();
        if (texts.length === 0) return { vectors: [] };
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/embeddings'),
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: this.config.modelId,
                    input: texts
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `OpenAI Embedding failed: ${response.status}`);
        }

        const json = await response.json();
        const vectors = json.data
            .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
            .map((d: { embedding: number[] }) => Float32Array.from(d.embedding));

        return { vectors };
    }
}
