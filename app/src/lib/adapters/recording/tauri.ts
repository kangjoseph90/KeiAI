import { Channel, invoke } from '@tauri-apps/api/core';
import { AppError } from '$lib/types/errors';
import type {
    AudioRecorderAdapter,
    AudioRecording,
    RecordedAudio,
    StartAudioRecordingOptions
} from './types';

interface RecordingEvent {
    kind: 'level' | 'error';
    level?: number;
    message?: string;
}

const MIME_TYPE = 'audio/wav';

export class TauriAudioRecorderAdapter implements AudioRecorderAdapter {
    async start({ signal, onLevel }: StartAudioRecordingOptions): Promise<AudioRecording> {
        signal.throwIfAborted();

        const recordingId = createRecordingId();
        const events = new Channel<RecordingEvent>();
        let nativeStarted = false;
        let settled = false;
        let finishPromise: Promise<RecordedAudio> | null = null;
        let rejectFailure!: (error: unknown) => void;
        const failure = new Promise<never>((_resolve, reject) => {
            rejectFailure = reject;
        });

        const cleanup = (): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
        };

        const cancelNative = (): void => {
            if (!nativeStarted) return;
            nativeStarted = false;
            void invoke('cancel_audio_recording', { recordingId }).catch(() => undefined);
        };

        const cancel = (): void => {
            if (settled) return;
            cleanup();
            cancelNative();
        };

        const handleAbort = (): void => cancel();
        signal.addEventListener('abort', handleAbort, { once: true });
        events.onmessage = (event) => {
            if (settled) return;
            if (event.kind === 'level') {
                if (typeof event.level === 'number') onLevel?.(event.level);
                return;
            }
            const error = new AppError(
                'ASSET_ERROR',
                event.message || 'Native audio recording failed'
            );
            rejectFailure(error);
            cancelNative();
            cleanup();
        };

        try {
            await invoke('start_audio_recording', { recordingId, events });
            nativeStarted = true;
        } catch (error) {
            cleanup();
            throw new AppError('INVALID_INPUT', 'Could not access the microphone', error);
        }

        if (signal.aborted || settled) {
            cancelNative();
            signal.throwIfAborted();
            throw new AppError('ASSET_ERROR', 'Audio recording was cancelled');
        }

        return {
            failure,
            cancel,
            finish: async () => {
                signal.throwIfAborted();
                if (finishPromise) return finishPromise;

                finishPromise = Promise.race([
                    (async (): Promise<RecordedAudio> => {
                        try {
                            const response = await invoke<ArrayBuffer | Uint8Array | number[]>(
                                'finish_audio_recording',
                                { recordingId }
                            );
                            nativeStarted = false;
                            return { data: toUint8Array(response), mimeType: MIME_TYPE };
                        } catch (error) {
                            throw new AppError(
                                'ASSET_ERROR',
                                'Native audio recording failed to finish',
                                error
                            );
                        } finally {
                            cleanup();
                        }
                    })(),
                    failure
                ]);
                return finishPromise;
            }
        };
    }
}

function createRecordingId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `recording-${Date.now()}`;
}

function toUint8Array(value: ArrayBuffer | Uint8Array | number[]): Uint8Array<ArrayBuffer> {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value);
}
