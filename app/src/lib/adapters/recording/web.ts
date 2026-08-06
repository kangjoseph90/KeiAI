import { AppError } from '$lib/types/errors';
import type { AudioRecorderAdapter, AudioRecording, StartAudioRecordingOptions } from './types';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export class WebAudioRecorderAdapter implements AudioRecorderAdapter {
    async start({ signal, onLevel }: StartAudioRecordingOptions): Promise<AudioRecording> {
        const mediaDevices = globalThis.navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            throw new AppError(
                'NOT_IMPLEMENTED',
                'Audio recording is not supported on this device'
            );
        }

        signal.throwIfAborted();
        let stream: MediaStream;
        try {
            stream = await mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            if (signal.aborted) signal.throwIfAborted();
            throw new AppError('INVALID_INPUT', 'Could not access the microphone', error);
        }
        if (signal.aborted) {
            stopTracks(stream);
            signal.throwIfAborted();
        }

        const mimeType = selectMimeType();
        let recorder: MediaRecorder;
        try {
            recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);
        } catch (error) {
            stopTracks(stream);
            throw new AppError('NOT_IMPLEMENTED', 'Could not start audio recording', error);
        }
        const chunks: Blob[] = [];
        let settled = false;
        let finishPromise: Promise<{ data: Uint8Array<ArrayBuffer>; mimeType: string }> | null =
            null;
        const meter = createLevelMeter(stream, onLevel);
        let rejectFailure!: (error: unknown) => void;
        const failure = new Promise<never>((_resolve, reject) => {
            rejectFailure = reject;
        });

        const cleanup = (): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            meter.stop();
            stopTracks(stream);
        };

        const cancel = (): void => {
            if (settled) return;
            if (recorder.state !== 'inactive') recorder.stop();
            cleanup();
        };

        const handleAbort = (): void => cancel();
        signal.addEventListener('abort', handleAbort, { once: true });
        recorder.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener(
            'error',
            () => {
                cleanup();
                rejectFailure(new AppError('ASSET_ERROR', 'Audio recording failed'));
            },
            { once: true }
        );
        try {
            recorder.start(250);
        } catch (error) {
            cleanup();
            throw new AppError('ASSET_ERROR', 'Audio recording failed to start', error);
        }

        return {
            failure,
            cancel,
            finish: async () => {
                if (signal.aborted) signal.throwIfAborted();
                if (finishPromise) return finishPromise;

                const stopped = new Promise<{
                    data: Uint8Array<ArrayBuffer>;
                    mimeType: string;
                }>((resolve, reject) => {
                    const handleStop = async (): Promise<void> => {
                        try {
                            const resolvedMimeType =
                                recorder.mimeType || chunks[0]?.type || 'audio/webm';
                            const blob = new Blob(chunks, { type: resolvedMimeType });
                            const buffer = await blob.arrayBuffer();
                            resolve({
                                data: new Uint8Array(buffer),
                                mimeType: resolvedMimeType
                            });
                        } catch (error) {
                            reject(error);
                        } finally {
                            cleanup();
                        }
                    };
                    recorder.addEventListener('stop', () => void handleStop(), { once: true });
                    if (recorder.state === 'inactive') {
                        void handleStop();
                    } else {
                        recorder.stop();
                    }
                });
                finishPromise = Promise.race([stopped, failure]);
                return finishPromise;
            }
        };
    }
}

function selectMimeType(): string | undefined {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
    return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
}

function createLevelMeter(
    stream: MediaStream,
    onLevel?: (level: number) => void
): { stop(): void } {
    if (!onLevel || typeof AudioContext === 'undefined') return { stop: () => undefined };

    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
        context = new AudioContext();
        void context.resume().catch(() => undefined);
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
    } catch {
        void context?.close();
        return { stop: () => undefined };
    }
    const samples = new Uint8Array(analyser.fftSize);
    let frame: number | undefined;
    let stopped = false;

    const read = (): void => {
        if (stopped) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
        }
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3));
        frame = requestAnimationFrame(read);
    };
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(read);

    return {
        stop: () => {
            if (stopped) return;
            stopped = true;
            if (frame !== undefined && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(frame);
            }
            source.disconnect();
            analyser.disconnect();
            void context.close();
        }
    };
}
