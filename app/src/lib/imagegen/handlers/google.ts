/**
 * Google Native Image Generation Handler — KeiAI
 *
 * Uses Gemini Nano Banana models through generateContent.
 */

import type { ImageGenImage, ImageGenRequest, ImageGenHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';
import { toBase64 } from '$lib/crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GoogleImageGenConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class GoogleImageGenHandler implements ImageGenHandler {
    private readonly config: GoogleImageGenConfig;

    constructor(config: GoogleImageGenConfig) {
        this.config = config;
    }

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        const modelId = this.config.modelId.replace(/^models\//, '');
        const negativePrompt = request.negativePrompt?.trim();
        const prompt = negativePrompt
            ? `${request.prompt}\n\nAvoid the following: ${negativePrompt}`
            : request.prompt;
        const parts: GeminiRequestPart[] = [{ text: prompt }];

        if (request.referenceImages.length > 0) {
            parts.push({ text: 'Use the following images as content and subject references.' });
            for (const image of request.referenceImages) {
                parts.push({
                    inlineData: {
                        data: toBase64(image.data),
                        mimeType: image.mimeType
                    }
                });
            }
        }

        if (request.styleImages.length > 0) {
            parts.push({ text: 'Use the following images as style references.' });
            for (const image of request.styleImages) {
                parts.push({
                    inlineData: {
                        data: toBase64(image.data),
                        mimeType: image.mimeType
                    }
                });
            }
        }

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, `/models/${modelId}:generateContent`),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
                },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseModalities: ['IMAGE']
                    }
                }),
                signal
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unknown error');
            throw new AppError(
                'NETWORK_ERROR',
                `Google ImageGen failed (${response.status}): ${errorBody}`
            );
        }

        const json = (await response.json()) as GeminiImageResponse;
        for (const candidate of json.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
                const inlineData = part.inlineData;
                if (!inlineData?.data || !inlineData.mimeType?.startsWith('image/')) continue;
                return {
                    base64: inlineData.data,
                    mimeType: inlineData.mimeType
                };
            }
        }

        throw new AppError('NETWORK_ERROR', 'Google ImageGen returned no image');
    }
}

interface GeminiImageResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                inlineData?: {
                    data?: string;
                    mimeType?: string;
                };
            }>;
        };
    }>;
}

type GeminiRequestPart =
    | { text: string }
    | {
          inlineData: {
              data: string;
              mimeType: string;
          };
      };
