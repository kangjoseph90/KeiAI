/**
 * Transformers TTS Handler — KeiAI
 *
 * Implements TTSStreamHandler using the local inference adapter.
 * Used by Kokoro and generic transformers models.
 */

import { appInference } from '$lib/adapters/inference';
import type { TTSStreamHandler, TTSStreamChunk } from '../types';

export interface TransformersTTSConfig {
    modelId: string;
    voiceId: string;
}

export class TransformersTTSStreamHandler implements TTSStreamHandler {
    private readonly config: TransformersTTSConfig;

    constructor(config: TransformersTTSConfig) {
        this.config = config;
    }

    async *synthesize(text: string, _signal?: AbortSignal): AsyncIterable<TTSStreamChunk> {
        if (!text.trim()) return;

        // Route synthesis computation to the common inference adapter
        const stream = appInference.synthesize(
            { modelId: this.config.modelId },
            text,
            this.config.voiceId,
            {
                device: 'wasm' // Using WASM as default for maximum compatibility
            }
        );

        for await (const audioBuffer of stream) {
            yield { audio: audioBuffer };
        }
    }
}
