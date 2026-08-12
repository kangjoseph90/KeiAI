/**
 * Google Gemini Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler for Google Gemini API.
 * Uses batchEmbedContents for efficient multi-text embedding.
 */

import type { EmbeddingResult, EmbeddingHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GoogleEmbeddingConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class GoogleEmbeddingHandler implements EmbeddingHandler {
    private readonly config: GoogleEmbeddingConfig;

    constructor(config: GoogleEmbeddingConfig) {
        this.config = config;
    }

    async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        if (texts.length === 0) return { vectors: [] };

        // Ensure modelId has 'models/' prefix if not present for the URL/Payload
        const modelName = this.config.modelId.startsWith('models/')
            ? this.config.modelId
            : `models/${this.config.modelId}`;

        // Use batchEmbedContents for all requests for consistency and efficiency
        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, `/${modelName}:batchEmbedContents`),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
                },
                body: JSON.stringify({
                    requests: texts.map((text) => ({
                        model: modelName,
                        content: {
                            parts: [{ text }]
                        }
                    }))
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unknown error');
            throw new AppError(
                'NETWORK_ERROR',
                `Google Embedding failed (${response.status}): ${errorBody}`
            );
        }

        const json = await response.json();

        if (!json.embeddings || !Array.isArray(json.embeddings)) {
            throw new AppError(
                'NETWORK_ERROR',
                'Google Embedding returned invalid response structure'
            );
        }

        const vectors = json.embeddings.map((e: { values: number[] }) =>
            Float32Array.from(e.values)
        );

        return { vectors };
    }
}
