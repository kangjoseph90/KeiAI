/**
 * TTS Types — KeiAI
 *
 * Shared interfaces for the text-to-speech handler layer.
 * Non-streaming: returns synthesized audio in one shot.
 */

export interface TTSResult {
    data: Uint8Array<ArrayBuffer>;
    mimeType: string;
}

export interface TTSHandler {
    synthesize(text: string, signal: AbortSignal): Promise<TTSResult>;
}
