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
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAISTTHandler implements STTHandler {
    private readonly config: OpenAISTTConfig;

    constructor(config: OpenAISTTConfig) {
        this.config = config;
    }

    async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
        const formData = new FormData();
        formData.append('file', audio, 'audio.webm');
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
            }
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
