/**
 * OpenAI STT Handler — KeiAI
 *
 * Implements STTHandler for OpenAI's /audio/transcriptions endpoint (Whisper).
 * Also covers any OpenAI-compatible STT API (e.g. Groq).
 */

import type { STTResult, STTHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAISTTConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    /** Response format: "json" | "text" | "srt" | "verbose_json" | "vtt" */
    responseFormat?: string;
    useProxy?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAISTTHandler implements STTHandler {
    private readonly config: OpenAISTTConfig;

    constructor(config: OpenAISTTConfig) {
        this.config = config;
    }

    async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
        const formData = new FormData();
        formData.append('file', audio, audioFileName(audio));
        formData.append('model', this.config.modelId);
        formData.append('response_format', this.config.responseFormat ?? 'verbose_json');

        const headers: Record<string, string> = {};
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, '/audio/transcriptions'),
            {
                method: 'POST',
                headers,
                body: formData,
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `OpenAI STT failed: ${response.status}`);
        }

        const json = await response.json();

        return {
            text: json.text ?? '',
            segments: json.segments?.map((s: { text: string; start: number; end: number }) => ({
                text: s.text,
                start: s.start,
                end: s.end
            }))
        };
    }
}

function audioFileName(audio: Blob): string {
    if (typeof File !== 'undefined' && audio instanceof File && audio.name) {
        return audio.name;
    }
    switch (audio.type.trim().toLowerCase().split(';', 1)[0]) {
        case 'audio/wav':
        case 'audio/x-wav':
            return 'audio.wav';
        case 'audio/mpeg':
            return 'audio.mp3';
        case 'audio/ogg':
            return 'audio.ogg';
        case 'audio/mp4':
            return 'audio.m4a';
        default:
            return 'audio.webm';
    }
}
