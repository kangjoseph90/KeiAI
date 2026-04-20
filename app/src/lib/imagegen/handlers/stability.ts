/**
 * Stability AI Image Generation Handler — KeiAI
 *
 * Implements ImageGenHandler for Stability AI's image generation API.
 * Uses the Stable Image /v2beta REST endpoint.
 */

import type { ImageGenResult, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface StabilityImageGenConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    /** Output format: "png" | "jpeg" | "webp" */
    outputFormat?: string;
    aspectRatio?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class StabilityImageGenHandler implements ImageGenHandler {
    private readonly config: StabilityImageGenConfig;

    constructor(config: StabilityImageGenConfig) {
        this.config = config;
    }

    async generate(prompt: string, signal?: AbortSignal): Promise<ImageGenResult> {
        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, `/v2beta/stable-image/generate/${this.config.modelId}`),
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
                    Accept: 'image/*'
                },
                body: JSON.stringify({
                    prompt,
                    output_format: this.config.outputFormat ?? 'png',
                    aspect_ratio: this.config.aspectRatio ?? '1:1'
                }),
                signal
            }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `Stability ImageGen failed: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        return { images: [{ base64 }] };
    }
}
