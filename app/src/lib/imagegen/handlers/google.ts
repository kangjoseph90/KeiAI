/**
 * Google Imagen Handler — KeiAI
 *
 * Implements ImageGenHandler for Google's Imagen API via
 * the generativelanguage endpoint.
 */

import type { ImageGenResult, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GoogleImageGenConfig {
	apiKey?: string;
	modelId: string;
	baseUrl: string;
	/** Number of images to generate */
	n?: number;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class GoogleImageGenHandler implements ImageGenHandler {
	private readonly config: GoogleImageGenConfig;

	constructor(config: GoogleImageGenConfig) {
		this.config = config;
	}

	async generate(prompt: string, signal?: AbortSignal): Promise<ImageGenResult> {
		const modelName = this.config.modelId.startsWith('models/')
			? this.config.modelId
			: `models/${this.config.modelId}`;

		const response = await appHttp.fetch(buildUrl(this.config.baseUrl, `/${modelName}:predict`), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
			},
			body: JSON.stringify({
				instances: [{ prompt }],
				parameters: {
					sampleCount: this.config.n ?? 1
				}
			}),
			signal
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => 'Unknown error');
			throw new AppError(
				'NETWORK_ERROR',
				`Google ImageGen failed (${response.status}): ${errorBody}`
			);
		}

		const json = await response.json();
		const images = (json.predictions ?? []).map((p: { bytesBase64Encoded?: string }) => ({
			base64: p.bytesBase64Encoded
		}));

		return { images };
	}
}
