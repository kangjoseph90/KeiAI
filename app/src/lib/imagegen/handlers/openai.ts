/**
 * OpenAI Image Generation Handler — KeiAI
 *
 * Implements ImageGenHandler for OpenAI's /images/generations endpoint.
 * Also covers any OpenAI-compatible image generation API.
 */

import type { ImageGenResult, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAIImageGenConfig {
	apiKey?: string;
	modelId: string;
	baseUrl: string;
	/** Image size, e.g. "1024x1024" */
	size?: string;
	/** Response format: "url" | "b64_json" */
	responseFormat?: string;
	n?: number;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAIImageGenHandler implements ImageGenHandler {
	private readonly config: OpenAIImageGenConfig;

	constructor(config: OpenAIImageGenConfig) {
		this.config = config;
	}

	async generate(prompt: string, signal?: AbortSignal): Promise<ImageGenResult> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (this.config.apiKey) {
			headers.Authorization = `Bearer ${this.config.apiKey}`;
		}

		const response = await appHttp.fetch(buildUrl(this.config.baseUrl, '/images/generations'), {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.config.modelId,
				prompt,
				n: this.config.n ?? 1,
				size: this.config.size ?? '1024x1024',
				response_format: this.config.responseFormat ?? 'b64_json'
			}),
			signal
		});

		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `OpenAI ImageGen failed: ${response.status}`);
		}

		const json = await response.json();
		const images = json.data.map((d: { url?: string; b64_json?: string }) => ({
			base64: d.b64_json,
			url: d.url
		}));

		return { images };
	}
}
