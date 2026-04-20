/**
 * Google Gemini TTS Stream Handler — KeiAI
 *
 * Implements the TTSStreamHandler interface for Google's Gemini-based TTS (e.g., gemini-2.5-flash-preview-tts).
 */

import type { TTSStreamHandler, TTSStreamChunk } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';

export interface GoogleTTSConfig {
    apiKey?: string;
    baseUrl: string;
    modelId: string;
    voiceId: string;
}

export class GoogleTTSStreamHandler implements TTSStreamHandler {
    private readonly config: GoogleTTSConfig;

    constructor(config: GoogleTTSConfig) {
        this.config = config;
    }

    async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<TTSStreamChunk> {
        if (!text.trim()) return;

        // It uses the same generateContent REST endpoint
        const url = buildUrl(this.config.baseUrl, `/models/${this.config.modelId}:generateContent`);

        const body = JSON.stringify({
            contents: [
                {
                    parts: [{ text }]
                }
            ],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: this.config.voiceId
                        }
                    }
                }
            }
        });

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
                },
                body
            },
            { proxy: true, signal }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `Google TTS API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        const data = await response.json();
        const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!base64Audio) {
            throw new AppError('NETWORK_ERROR', 'Google TTS API returned no audio data');
        }

        // Convert Base64 back to ArrayBuffer
        const binaryStr = atob(base64Audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        yield { audio: bytes.buffer };
    }
}
