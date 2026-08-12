/**
 * Kokoro TTS Handler — KeiAI
 *
 * Runs Kokoro synthesis in the shared local inference worker.
 */

import { kokoro } from '$lib/inference';
import { AppError } from '$lib/types/errors';
import { isKokoroVoiceId } from '$lib/types/models/tts';
import type { TTSHandler, TTSResult } from '../types';

export interface KokoroTTSConfig {
    voiceId: string;
}

export class KokoroTTSHandler implements TTSHandler {
    constructor(private readonly config: KokoroTTSConfig) {}

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        if (!isKokoroVoiceId(this.config.voiceId)) {
            throw new AppError('INVALID_INPUT', `Unknown Kokoro voice: ${this.config.voiceId}`);
        }
        return kokoro.synthesize(text, this.config.voiceId, signal);
    }
}
