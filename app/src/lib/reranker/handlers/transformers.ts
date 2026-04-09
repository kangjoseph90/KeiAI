/**
 * Transformers Reranker Handler — KeiAI
 *
 * Implements RerankerHandler using local embedding + cosine similarity.
 * Bi-encoder approach: embed query and documents separately, then rank by similarity.
 * Less accurate than cross-encoder but works with any embedding model.
 */

import { appInference } from '$lib/adapters/inference';
import type { RerankerResult, RerankerItem, RerankerHandler } from '../types';

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

	async rerank(query: string, documents: string[], _signal?: AbortSignal): Promise<RerankerResult> {
		if (documents.length === 0) return { results: [] };

		// Delegate to appInference which uses the 'text-classification' cross-encoder pipeline
		const scores = await appInference.rerank({ modelId: this.config.modelId }, query, documents, {
			device: 'wasm'
		});

		const results: RerankerItem[] = scores.map((score, index) => ({
			index,
			score
		}));

		// Sort by score descending
		results.sort((a, b) => b.score - a.score);

		return { results };
	}
}
