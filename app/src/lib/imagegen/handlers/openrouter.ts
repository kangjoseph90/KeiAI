import { appHttp } from '$lib/adapters/http';
import { toBase64 } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';
import type { ImageGenHandler, ImageGenImage, ImageGenRequest } from '../types';

export interface OpenRouterImageGenConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    useProxy?: boolean;
    aspectRatio?: string;
    resolution?: string;
    size?: string;
    quality?: string;
    outputFormat?: string;
    background?: string;
}

export class OpenRouterImageGenHandler implements ImageGenHandler {
    private readonly config: OpenRouterImageGenConfig;

    constructor(config: OpenRouterImageGenConfig) {
        this.config = config;
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        const negativePrompt = request.negativePrompt?.trim();
        const prompt = negativePrompt
            ? `${request.prompt}\n\nAvoid the following: ${negativePrompt}`
            : request.prompt;
        const inputReferences = [...request.referenceImages, ...request.styleImages].map(
            (image) => ({
                type: 'image_url',
                image_url: {
                    url: `data:${image.mimeType};base64,${toBase64(image.data)}`
                }
            })
        );

        const body: Record<string, unknown> = {
            model: this.config.modelId,
            prompt,
            n: 1,
            ...(this.config.aspectRatio ? { aspect_ratio: this.config.aspectRatio } : {}),
            ...(this.config.resolution ? { resolution: this.config.resolution } : {}),
            ...(this.config.size ? { size: this.config.size } : {}),
            ...(this.config.quality ? { quality: this.config.quality } : {}),
            ...(this.config.outputFormat ? { output_format: this.config.outputFormat } : {}),
            ...(this.config.background ? { background: this.config.background } : {}),
            ...(inputReferences.length > 0 ? { input_references: inputReferences } : {})
        };
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        };
        if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/images'),
            { method: 'POST', headers, body: JSON.stringify(body), signal },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            const error = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `OpenRouter ImageGen failed (${response.status})${error ? `: ${error}` : ''}`
            );
        }

        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.data)) {
            throw new AppError('NETWORK_ERROR', 'OpenRouter ImageGen returned an invalid response');
        }
        const image = payload.data[0];
        if (!isRecord(image)) {
            throw new AppError('NETWORK_ERROR', 'OpenRouter ImageGen returned no image');
        }

        const base64 = typeof image.b64_json === 'string' ? image.b64_json : undefined;
        const url = typeof image.url === 'string' ? image.url : undefined;
        if (!base64 && !url) {
            throw new AppError('NETWORK_ERROR', 'OpenRouter ImageGen returned no image data');
        }

        return {
            base64,
            url,
            mimeType:
                typeof image.media_type === 'string'
                    ? image.media_type
                    : mimeTypeForFormat(this.config.outputFormat)
        };
    }
}

function mimeTypeForFormat(format?: string): string {
    if (!format) return 'image/png';
    return `image/${format === 'jpg' ? 'jpeg' : format}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
