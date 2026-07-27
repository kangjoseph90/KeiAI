/**
 * Google STT Handler — KeiAI
 *
 * Implements STTHandler for Google's Speech-to-Text API.
 * Uses the v1/speech:recognize endpoint.
 */

import type { STTResult, STTHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';
import { toBase64 } from '$lib/crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GoogleSTTConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    /** Language code, e.g. "en-US", "ko-KR" */
    languageCode?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class GoogleSTTHandler implements STTHandler {
    private readonly config: GoogleSTTConfig;

    constructor(config: GoogleSTTConfig) {
        this.config = config;
    }

    async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
        const audioBytes = new Uint8Array(await audio.arrayBuffer());
        const audioConfig = getAudioConfig(audio, audioBytes);

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/v1/speech:recognize'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
                },
                body: JSON.stringify({
                    config: {
                        ...audioConfig,
                        languageCode: this.config.languageCode ?? 'en-US',
                        model: this.config.modelId,
                        enableWordTimeOffsets: true
                    },
                    audio: {
                        content: toBase64(audioBytes)
                    }
                }),
                signal
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unknown error');
            throw new AppError(
                'NETWORK_ERROR',
                `Google STT failed (${response.status}): ${errorBody}`
            );
        }

        const json = await response.json();
        const results = json.results ?? [];
        const segments: STTResult['segments'] = [];

        let fullText = '';
        for (const result of results) {
            const alt = result.alternatives?.[0];
            if (!alt) continue;
            fullText += (fullText ? ' ' : '') + alt.transcript;

            if (alt.words?.length) {
                const words = alt.words;
                const start = durationSeconds(words[0].startTime);
                const lastWord = words[words.length - 1];
                const end = durationSeconds(lastWord.endTime);
                segments.push({ text: alt.transcript, start, end });
            }
        }

        return { text: fullText, segments: segments.length ? segments : undefined };
    }
}

function getAudioConfig(audio: Blob, bytes: Uint8Array): Record<string, string | number> {
    const mimeType = audio.type.trim().toLowerCase().split(';', 1)[0];
    switch (mimeType) {
        case 'audio/wav':
        case 'audio/x-wav': {
            const sampleRate = wavSampleRate(bytes);
            return {
                encoding: 'LINEAR16',
                ...(sampleRate ? { sampleRateHertz: sampleRate } : {})
            };
        }
        case 'audio/mpeg':
            return { encoding: 'MP3' };
        case 'audio/ogg':
            return { encoding: 'OGG_OPUS' };
        case 'audio/webm':
            return { encoding: 'WEBM_OPUS' };
        default:
            throw new AppError(
                'INVALID_INPUT',
                `Google STT does not support the audio format: ${mimeType || '(unknown)'}`
            );
    }
}

function wavSampleRate(bytes: Uint8Array): number | undefined {
    if (bytes.byteLength < 28) return undefined;
    const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12));
    if (!header.startsWith('RIFF') || !header.endsWith('WAVE')) return undefined;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(24, true);
}

function durationSeconds(value: unknown): number {
    if (typeof value === 'string') {
        return Number(value.endsWith('s') ? value.slice(0, -1) : value);
    }
    if (!value || typeof value !== 'object') return 0;
    const duration = value as { seconds?: unknown; nanos?: unknown };
    return Number(duration.seconds ?? 0) + Number(duration.nanos ?? 0) / 1_000_000_000;
}
