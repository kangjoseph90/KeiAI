/**
 * Transformers Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler using the local Transformers.js runtime.
 */

import { transformers } from '$lib/inference';
import type { EmbeddingHandler, EmbeddingResult } from '../types';

export interface TransformersEmbeddingConfig {
    modelId: string;
}

export class TransformersEmbeddingHandler implements EmbeddingHandler {
    private readonly config: TransformersEmbeddingConfig;

    constructor(config: TransformersEmbeddingConfig) {
        this.config = config;
    }

    async embed(texts: string[], _signal?: AbortSignal): Promise<EmbeddingResult> {
        if (texts.length === 0) return { vectors: [] };

        const vectors = await transformers.embed({ modelId: this.config.modelId }, texts, {
            device: 'wasm' // Using WASM as default for maximum compatibility across Web/Tauri
        });

        return { vectors };
    }
}
