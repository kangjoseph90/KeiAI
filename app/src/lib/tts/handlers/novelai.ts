/**
 * NovelAI TTS Handler — KeiAI
 *
 * Implements the TTSHandler interface for NovelAI's TTS API.
 */

import type { TTSHandler, TTSResult } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';

export interface NovelAITTSConfig {
    apiKey?: string;
    baseUrl: string;
    voiceId: string;
    version: string;
    useProxy?: boolean;
}

export class NovelAITTSHandler implements TTSHandler {
    private readonly config: NovelAITTSConfig;

    constructor(config: NovelAITTSConfig) {
        this.config = config;
    }

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
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
                    version: this.config.version,
                    voice: this.config.version === 'v1' ? this.config.voiceId : -1,
                    ...(this.config.version === 'v2' ? { seed: this.config.voiceId } : {}),
                    opus: false
                })
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AppError(
                'NETWORK_ERROR',
                `NovelAI TTS API error ${response.status}: ${errorBody || response.statusText}`
            );
        }

        const responseMimeType = response.headers
            .get('content-type')
            ?.split(';', 1)[0]
            ?.trim()
            .toLowerCase();
        const mimeType = responseMimeType?.startsWith('audio/') ? responseMimeType : 'audio/mpeg';
        return {
            data: new Uint8Array(await response.arrayBuffer()),
            mimeType
        };
    }
}
