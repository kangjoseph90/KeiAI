/**
 * ElevenLabs TTS Stream Handler — KeiAI
 *
 * Implements the TTSStreamHandler interface for ElevenLabs API.
 */

import type { TTSStreamHandler, TTSStreamChunk } from '../types';
import { AppError } from '$lib/types/errors';
import { appHttp } from '$lib/adapters/http';
import { buildUrl } from '$lib/utils/url';

export interface ElevenLabsTTSConfig {
	apiKey?: string;
	baseUrl: string;
	voiceId: string;
}

export class ElevenLabsTTSStreamHandler implements TTSStreamHandler {
	private readonly config: ElevenLabsTTSConfig;

	constructor(config: ElevenLabsTTSConfig) {
		this.config = config;
	}

	async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<TTSStreamChunk> {
		if (!text.trim()) return;

		const url = buildUrl(this.config.baseUrl, `/text-to-speech/${this.config.voiceId}/stream`);

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
					model_id: 'eleven_multilingual_v2', // Or parameterized from model config
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

		if (!response.body) {
			throw new AppError('NETWORK_ERROR', 'Response body is not readable');
		}

		const reader = response.body.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// value is a Uint8Array. Use its backing ArrayBuffer for the chunk.
				// Slice is used to safely pass isolated ArrayBuffer in case of boundary issues.
				const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
				yield { audio: buffer };
			}
		} finally {
			reader.releaseLock();
		}
	}
}
