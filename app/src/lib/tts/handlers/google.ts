/**
 * Google Gemini TTS Stream Handler — KeiAI
 *
 * Implements the TTSStreamHandler interface for Google's Gemini-based TTS.
 */

import type { TTSStreamHandler, TTSStreamChunk } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { fromBase64 } from '$lib/crypto';
import { pcm16ToWav } from '$lib/utils/audio';

interface GoogleTTSResponse {
    candidates?: {
        content?: {
            parts?: {
                inlineData?: {
                    data?: string;
                    mimeType?: string;
                };
            }[];
        };
    }[];
}

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

        const data = (await response.json()) as GoogleTTSResponse;
        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = inlineData?.data;

        if (!base64Audio) {
            throw new AppError('NETWORK_ERROR', 'Google TTS API returned no audio data');
        }

        const pcm = fromBase64(base64Audio);
        const sampleRate = parseSampleRate(inlineData.mimeType) ?? 24000;
        yield { data: pcm16ToWav(pcm, sampleRate), mimeType: 'audio/wav' };
    }
}

function parseSampleRate(mimeType?: string): number | undefined {
    const value = mimeType?.match(/(?:^|;)\s*rate=(\d+)/i)?.[1];
    if (!value) return undefined;
    const sampleRate = Number(value);
    return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined;
}
