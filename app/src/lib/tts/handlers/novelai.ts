/**
 * NovelAI TTS Stream Handler — KeiAI
 *
 * Implements the TTSStreamHandler interface for NovelAI's TTS API.
 */

import type { TTSStreamHandler, TTSStreamChunk } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';

export interface NovelAITTSConfig {
    apiKey?: string;
    baseUrl: string;
    voiceId: string;
    version: string;
}

export class NovelAITTSStreamHandler implements TTSStreamHandler {
    private readonly config: NovelAITTSConfig;

    constructor(config: NovelAITTSConfig) {
        this.config = config;
    }

    async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<TTSStreamChunk> {
        if (!text.trim()) return;

        const url = buildUrl(this.config.baseUrl, '/ai/generate-voice');

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    text,
                    speaker: this.config.voiceId,
                    seed: 'kei_seed', // Can be randomized or parameterized later
                    version: this.config.version,
                    return_audio: true
                })
            },
            { proxy: true, signal }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `NovelAI TTS API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        // Response is raw audio binary array buffer (usually MPEG)
        const arrayBuffer = await response.arrayBuffer();
        yield { audio: arrayBuffer };
    }
}
