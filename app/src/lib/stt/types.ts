/**
 * STT Types — KeiAI
 *
 * Shared interfaces for the speech-to-text adapter layer.
 * Non-streaming: returns transcription result in one shot.
 */

export interface STTSegment {
    text: string;
    start: number;
    end: number;
}

export interface STTResult {
    text: string;
    segments?: STTSegment[];
}

export interface STTHandler {
    transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult>;
}
