import type { KokoroTTS } from 'kokoro-js';
import type { KokoroVoiceId } from '$lib/types/models/tts';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export class KokoroInference {
    private modelPromise: Promise<KokoroTTS> | undefined;

    async synthesize(
        text: string,
        voiceId: KokoroVoiceId,
        signal: AbortSignal
    ): Promise<Uint8Array> {
        signal.throwIfAborted();
        const model = await this.loadModel();
        signal.throwIfAborted();
        const audio = await model.generate(text, { voice: voiceId });
        signal.throwIfAborted();
        return new Uint8Array(audio.toWav());
    }

    async dispose(): Promise<void> {
        const pending = this.modelPromise;
        this.modelPromise = undefined;
        if (!pending) return;
        const model = await pending;
        await model.model.dispose();
    }

    private async loadModel(): Promise<KokoroTTS> {
        if (!this.modelPromise) {
            this.modelPromise = import('kokoro-js')
                .then(({ KokoroTTS }) =>
                    KokoroTTS.from_pretrained(MODEL_ID, {
                        dtype: 'q8',
                        device: 'wasm'
                    })
                )
                .catch((error: unknown) => {
                    this.modelPromise = undefined;
                    throw error;
                });
        }
        return this.modelPromise;
    }
}

export const kokoro = new KokoroInference();
