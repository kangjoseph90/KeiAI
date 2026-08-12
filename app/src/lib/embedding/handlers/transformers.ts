/**
 * Transformers Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler using the local Transformers.js runtime.
 */

import { transformers } from '$lib/inference';
import type { DocumentEmbeddingResult, EmbeddingHandler, EmbeddingResult } from '../types';
import { groupEmbeddingVectors } from '../grouping';

export interface TransformersEmbeddingConfig {
    modelId: string;
}

export class TransformersEmbeddingHandler implements EmbeddingHandler {
    private readonly config: TransformersEmbeddingConfig;

    constructor(config: TransformersEmbeddingConfig) {
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

        const vectors = await transformers.embed({ modelId: this.config.modelId }, texts, {
            device: 'wasm', // Using WASM as default for maximum compatibility across Web/Tauri
            signal
        });

        return { vectors };
    }
}
