/**
 * Transformers Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler using the local inference adapter.
 * Uses @huggingface/transformers or native ONNX via appInference.
 */

import { appInference } from '$lib/adapters/inference';
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

		// Route embedding computation to the common inference adapter
		const vectors = await appInference.embed({ modelId: this.config.modelId }, texts, {
			device: 'wasm' // Using WASM as default for maximum compatibility across Web/Tauri
		});

		return { vectors };
	}
}
