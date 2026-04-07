/**
 * OpenAI TTS Handler — KeiAI
 *
 * Implements TTSStreamHandler for OpenAI's /audio/speech endpoint.
 * Streams raw PCM audio chunks via AsyncIterable.
 */

import type { TTSStreamChunk, TTSStreamHandler } from '../types';
import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface OpenAITTSConfig {
	apiKey?: string;
	baseUrl: string;
	modelId: string;
	voiceId: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class OpenAITTSStreamHandler implements TTSStreamHandler {
	private readonly config: OpenAITTSConfig;

	constructor(config: OpenAITTSConfig) {
		this.config = config;
	}

	async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk> {
		const response = await appHttp.fetch(`${this.config.baseUrl}/audio/speech`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
			},
			body: JSON.stringify({
				model: this.config.modelId,
				input: text,
				voice: this.config.voiceId,
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
