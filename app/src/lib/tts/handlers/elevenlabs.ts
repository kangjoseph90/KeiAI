/**
 * ElevenLabs TTS Handler — KeiAI
 *
 * Implements the TTSHandler interface for ElevenLabs API.
 */

import type { TTSHandler, TTSResult } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';

export interface ElevenLabsTTSConfig {
    apiKey?: string;
    baseUrl: string;
    modelId: string;
    voiceId: string;
}

export class ElevenLabsTTSHandler implements TTSHandler {
    private readonly config: ElevenLabsTTSConfig;

    constructor(config: ElevenLabsTTSConfig) {
        this.config = config;
    }

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        const url = buildUrl(
            this.config.baseUrl,
            `/text-to-speech/${this.config.voiceId}/stream?output_format=mp3_44100_128`
        );

        const response = await appHttp.fetch(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { 'xi-api-key': this.config.apiKey } : {})
                },
                body: JSON.stringify({
                    text,
                    model_id: this.config.modelId,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            },
            { proxy: true, signal }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `ElevenLabs TTS API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        return {
            data: new Uint8Array(await response.arrayBuffer()),
            mimeType: 'audio/mpeg'
        };
    }
}
