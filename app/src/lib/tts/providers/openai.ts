/**
 * OpenAI TTS Provider — KeiAI
 *
 * Implements TTSStreamProvider for OpenAI's /audio/speech endpoint.
 * Streams raw PCM audio chunks via AsyncIterable.
 */

import type { TTSStreamChunk, TTSStreamProvider } from '../types';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAITTSConfig {
	apiKey: string;
	voiceId: string;
	baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OpenAITTSStreamProvider implements TTSStreamProvider {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly voiceId: string;

	constructor(config: OpenAITTSConfig) {
		this.apiKey = config.apiKey;
		this.voiceId = config.voiceId;
		this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	}

	async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk> {
		const response = await appHttp.fetch(`${this.baseUrl}/audio/speech`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				model: 'tts-1',
				input: text,
				voice: this.voiceId,
				response_format: 'pcm'
			}),
			signal
		});

		if (!response.ok) {
			throw new AppError('NETWORK_ERROR', `OpenAI TTS failed: ${response.status}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new AppError('NETWORK_ERROR', 'Response body is not readable');
		}

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				yield { audio: value.buffer as ArrayBuffer };
			}
		} finally {
			reader.releaseLock();
		}
	}
}
