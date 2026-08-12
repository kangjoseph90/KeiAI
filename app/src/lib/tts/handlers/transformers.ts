/**
 * Transformers TTS Handler — KeiAI
 *
 * Implements TTSHandler using the local Transformers.js runtime.
 * Supports models that synthesize directly from text without a voice embedding.
 */

import { transformers } from '$lib/inference';
import { float32ToWav } from '$lib/utils/audio';
import type { TTSHandler, TTSResult } from '../types';

export interface TransformersTTSConfig {
    modelId: string;
}

export class TransformersTTSHandler implements TTSHandler {
    private readonly config: TransformersTTSConfig;

    constructor(config: TransformersTTSConfig) {
        this.config = config;
    }

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        signal.throwIfAborted();
        const result = await transformers.synthesize({ modelId: this.config.modelId }, text, {
            device: 'wasm', // Using WASM as default for maximum compatibility
            signal
        });
        signal.throwIfAborted();

        return {
            data: float32ToWav(new Float32Array(result.audio), result.sampleRate),
            mimeType: 'audio/wav'
        };
    }
}
