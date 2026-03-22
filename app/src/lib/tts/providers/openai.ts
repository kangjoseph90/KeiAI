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
	baseUrl: string;
	modelId: string;
	voiceId: string;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OpenAITTSStreamProvider implements TTSStreamProvider {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly modelId: string;
	private readonly voiceId: string;

	constructor(config: OpenAITTSConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl;
		this.modelId = config.modelId;
		this.voiceId = config.voiceId;
	}

	async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk> {
		const response = await appHttp.fetch(`${this.baseUrl}/audio/speech`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				model: this.modelId,
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
