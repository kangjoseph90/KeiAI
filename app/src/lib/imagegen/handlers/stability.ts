/**
 * Stability AI Image Generation Handler — KeiAI
 *
 * Implements ImageGenHandler for Stability AI's image generation API.
 * Uses the Stable Image /v2beta REST endpoint.
 */

import type { ImageGenImage, ImageGenRequest, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { toBase64 } from '$lib/crypto';
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

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        if (request.referenceImages.length > 0 || request.styleImages.length > 0) {
            throw new AppError(
                'NOT_IMPLEMENTED',
                'Stability image inputs are not supported by this handler yet'
            );
        }

        const negativePrompt = request.negativePrompt?.trim();
        const isStableDiffusionModel = this.config.modelId.startsWith('sd3.5-');
        const body = new FormData();
        body.append('prompt', request.prompt);
        body.append('output_format', this.config.outputFormat ?? 'png');
        body.append('aspect_ratio', this.config.aspectRatio ?? '1:1');
        if (negativePrompt) {
            body.append('negative_prompt', negativePrompt);
        }
        if (isStableDiffusionModel) {
            body.append('model', this.config.modelId);
        }

        const endpoint = isStableDiffusionModel ? 'sd3' : this.config.modelId;
        const headers: Record<string, string> = {
            Accept: 'image/*'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, `/v2beta/stable-image/generate/${endpoint}`),
            {
                method: 'POST',
                headers,
                body,
                signal
            }
        );

        if (!response.ok) {
            const error = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `Stability ImageGen failed (${response.status})${error ? `: ${error}` : ''}`
            );
        }

        const format = this.config.outputFormat ?? 'png';
        return {
            base64: toBase64(new Uint8Array(await response.arrayBuffer())),
            mimeType: `image/${format === 'jpg' ? 'jpeg' : format}`
        };
    }
}
