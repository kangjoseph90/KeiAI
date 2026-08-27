/**
 * OpenAI Image Generation Handler — KeiAI
 *
 * Implements ImageGenHandler for OpenAI's /images/generations endpoint.
 * Also covers any OpenAI-compatible image generation API.
 */

import type { ImageGenImage, ImageGenRequest, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { fromBase64 } from '$lib/crypto';
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
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAIImageGenHandler implements ImageGenHandler {
    private readonly config: OpenAIImageGenConfig;

    constructor(config: OpenAIImageGenConfig) {
        this.config = config;
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        const promptInstructions: string[] = [];
        if (request.referenceImages.length > 0) {
            promptInstructions.push(
                `The first ${request.referenceImages.length} input image(s) are content and subject references.`
            );
        }
        if (request.styleImages.length > 0) {
            promptInstructions.push(
                `The next ${request.styleImages.length} input image(s) are style references.`
            );
        }
        const negativePrompt = request.negativePrompt?.trim();
        if (negativePrompt) {
            promptInstructions.push(`Avoid the following: ${negativePrompt}`);
        }
        const prompt =
            promptInstructions.length > 0
                ? `${request.prompt}\n\n${promptInstructions.join('\n')}`
                : request.prompt;

        const headers: Record<string, string> = {};
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const inputImages = [...request.referenceImages, ...request.styleImages];
        let response: Response;
        if (inputImages.length === 0) {
            headers['Content-Type'] = 'application/json';
            response = await appHttp.fetch(
                buildUrl(this.config.baseUrl, '/images/generations'),
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: this.config.modelId,
                        prompt,
                        n: 1,
                        size: this.config.size ?? '1024x1024',
                        response_format: this.config.responseFormat ?? 'b64_json'
                    }),
                    signal
                },
                { proxy: this.config.useProxy ?? true, signal }
            );
        } else {
            const body = new FormData();
            body.append('model', this.config.modelId);
            body.append('prompt', prompt);
            body.append('n', '1');
            body.append('size', this.config.size ?? '1024x1024');
            body.append('response_format', this.config.responseFormat ?? 'b64_json');
            for (const [index, image] of inputImages.entries()) {
                body.append(
                    'image[]',
                    new Blob([image.data], { type: image.mimeType }),
                    `image-${index + 1}`
                );
            }
            response = await appHttp.fetch(
                buildUrl(this.config.baseUrl, '/images/edits'),
                {
                    method: 'POST',
                    headers,
                    body,
                    signal
                },
                { proxy: this.config.useProxy ?? true, signal }
            );
        }

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `OpenAI ImageGen failed: ${response.status}`);
        }

        const json = (await response.json()) as OpenAIImageResponse;
        const image = json.data?.[0];
        if (!image?.b64_json && !image?.url) {
            throw new AppError('NETWORK_ERROR', 'OpenAI ImageGen returned no image');
        }

        return {
            data: image.b64_json ? fromBase64(image.b64_json) : undefined,
            url: image.url
        };
    }
}

interface OpenAIImageResponse {
    data?: Array<{
        url?: string;
        b64_json?: string;
    }>;
}
