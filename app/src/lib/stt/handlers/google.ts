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
		const audioBuffer = await audio.arrayBuffer();
		const base64Audio = btoa(
			new Uint8Array(audioBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
		);

		const response = await appHttp.fetch(buildUrl(this.config.baseUrl, '/v1/speech:recognize'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {})
			},
			body: JSON.stringify({
				config: {
					encoding: 'WEBM_OPUS',
					sampleRateHertz: 48000,
					languageCode: this.config.languageCode ?? 'en-US',
					model: this.config.modelId,
					enableWordTimeOffsets: true
				},
				audio: {
					content: base64Audio
				}
			}),
			signal
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => 'Unknown error');
			throw new AppError('NETWORK_ERROR', `Google STT failed (${response.status}): ${errorBody}`);
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
				const start = Number(words[0].startTime?.seconds ?? 0);
				const lastWord = words[words.length - 1];
				const end = Number(lastWord.endTime?.seconds ?? 0);
				segments.push({ text: alt.transcript, start, end });
			}
		}

		return { text: fullText, segments: segments.length ? segments : undefined };
	}
}
