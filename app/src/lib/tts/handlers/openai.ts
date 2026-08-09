/**
 * OpenAI TTS Handler — KeiAI
 *
 * Implements TTSHandler for OpenAI's /audio/speech endpoint.
 */

import type { TTSHandler, TTSResult } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAITTSConfig {
    apiKey?: string;
    baseUrl: string;
    modelId: string;
    voiceId: string;
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAITTSHandler implements TTSHandler {
    private readonly config: OpenAITTSConfig;

    constructor(config: OpenAITTSConfig) {
        this.config = config;
    }

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/audio/speech'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    model: this.config.modelId,
                    input: text,
                    voice: this.config.voiceId,
                    response_format: 'mp3'
                }),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `OpenAI TTS failed: ${response.status}`);
        }

        return {
            data: new Uint8Array(await response.arrayBuffer()),
            mimeType: 'audio/mpeg'
        };
    }
}
