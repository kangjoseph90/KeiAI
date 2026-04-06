/**
 * OpenAI Embedding Handler — KeiAI
 *
 * Implements EmbeddingHandler for OpenAI's /embeddings endpoint.
 * Also covers any OpenAI-compatible embedding API.
 */

import type { EmbeddingResult, EmbeddingHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingConfig {
	apiKey: string;
	modelId: string;
	baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAIEmbeddingHandler implements EmbeddingHandler {
	private readonly apiKey: string;
	private readonly modelId: string;
	private readonly baseUrl: string;

	constructor(config: OpenAIEmbeddingConfig) {
		this.apiKey = config.apiKey;
		this.modelId = config.modelId;
		this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	}

	async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
		const response = await appHttp.fetch(`${this.baseUrl}/embeddings`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				model: this.modelId,
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
