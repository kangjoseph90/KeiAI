/**
 * Kokoro TTS Handler — KeiAI
 *
 * Uses kokoro-js so the selected Kokoro voice embedding is loaded and applied.
 */

import type { KokoroTTS } from 'kokoro-js';
import { AppError } from '$lib/types/errors';
import { isKokoroVoiceId } from '$lib/types/models/tts';
import type { TTSHandler, TTSResult } from '../types';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let modelPromise: Promise<KokoroTTS> | undefined;

export interface KokoroTTSConfig {
    voiceId: string;
}

async function loadModel(): Promise<KokoroTTS> {
    if (!modelPromise) {
        modelPromise = import('kokoro-js')
            .then(({ KokoroTTS }) =>
                KokoroTTS.from_pretrained(MODEL_ID, {
                    dtype: 'q8',
                    device: 'wasm'
                })
            )
            .catch((error: unknown) => {
                modelPromise = undefined;
                throw error;
            });
    }
    return modelPromise;
}

export class KokoroTTSHandler implements TTSHandler {
    private readonly config: KokoroTTSConfig;

    constructor(config: KokoroTTSConfig) {
        this.config = config;
    }

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        if (!isKokoroVoiceId(this.config.voiceId)) {
            throw new AppError('INVALID_INPUT', `Unknown Kokoro voice: ${this.config.voiceId}`);
        }

        signal.throwIfAborted();
        const model = await loadModel();
        signal.throwIfAborted();

        const audio = await model.generate(text, { voice: this.config.voiceId });
        signal.throwIfAborted();

        return {
            data: new Uint8Array(audio.toWav()),
            mimeType: 'audio/wav'
        };
    }
}
