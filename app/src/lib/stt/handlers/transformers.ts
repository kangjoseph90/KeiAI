/**
 * Transformers STT Handler — KeiAI
 *
 * Implements STTHandler using the local inference adapter.
 * Uses @huggingface/transformers Whisper models via appInference.
 */

import { appInference } from '$lib/adapters/inference';
import type { STTHandler, STTResult } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface TransformersSTTConfig {
	modelId: string;
	language?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class TransformersSTTHandler implements STTHandler {
	private readonly config: TransformersSTTConfig;

	constructor(config: TransformersSTTConfig) {
		this.config = config;
	}

	async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
		const result = await appInference.transcribe({ modelId: this.config.modelId }, audio, {
			device: 'wasm',
			language: this.config.language
		});

		// Respect abort signal — the adapter doesn't accept signal directly,
		// but we can check before returning
		if (signal?.aborted) {
			return { text: '' };
		}

		return result;
	}
}
