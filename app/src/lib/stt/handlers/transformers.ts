/**
 * Transformers STT Handler — KeiAI
 *
 * Implements STTHandler using the local Transformers.js runtime.
 */

import { transformers } from '$lib/inference';
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
        const result = await transformers.transcribe({ modelId: this.config.modelId }, audio, {
            device: 'wasm',
            language: this.config.language,
            signal
        });

        signal?.throwIfAborted();

        return result;
    }
}
