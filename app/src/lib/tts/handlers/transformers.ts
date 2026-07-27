/**
 * Transformers TTS Handler — KeiAI
 *
 * Implements TTSStreamHandler using the local inference adapter.
 * Supports models that synthesize directly from text without a voice embedding.
 */

import { appInference } from '$lib/adapters/inference';
import type { TTSStreamHandler, TTSStreamChunk } from '../types';
import { float32ToWav } from '$lib/utils/audio';

export interface TransformersTTSConfig {
    modelId: string;
}

export class TransformersTTSStreamHandler implements TTSStreamHandler {
    private readonly config: TransformersTTSConfig;

    constructor(config: TransformersTTSConfig) {
        this.config = config;
    }

    async *synthesize(text: string, _signal?: AbortSignal): AsyncIterable<TTSStreamChunk> {
        if (!text.trim()) return;

        // Route synthesis computation to the common inference adapter
        const stream = appInference.synthesize({ modelId: this.config.modelId }, text, {
            device: 'wasm' // Using WASM as default for maximum compatibility
        });

        for await (const result of stream) {
            yield {
                data: float32ToWav(new Float32Array(result.audio), result.sampleRate),
                mimeType: 'audio/wav'
            };
        }
    }
}
