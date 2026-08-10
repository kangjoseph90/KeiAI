import { AppError } from '$lib/types/errors';
import type {
    CameraAdapter,
    CameraCapture,
    CameraVideoRecording,
    StartCameraOptions
} from './types';

const PHOTO_MIME_TYPE = 'image/jpeg';
const PHOTO_QUALITY = 0.92;
const FILE_PICKER_FOCUS_SETTLE_MS = 150;
const VIDEO_BITS_PER_SECOND = 4_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const VIDEO_MIME_TYPES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
];

export class WebCameraAdapter implements CameraAdapter {
    async start({ signal }: StartCameraOptions): Promise<CameraCapture> {
        const getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia;
        if (!getUserMedia) {
            throw new AppError('NOT_IMPLEMENTED', 'Camera capture is not supported on this device');
        }

        signal.throwIfAborted();
        let stream: MediaStream;
        try {
            stream = await getUserMedia.call(globalThis.navigator.mediaDevices, {
                audio: false,
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
        } catch (error) {
            if (signal.aborted) signal.throwIfAborted();
            throw new AppError('INVALID_INPUT', 'Could not access the camera', error);
        }

        if (signal.aborted) {
            stopTracks(stream);
            signal.throwIfAborted();
        }

        let stopped = false;
        let preparingVideoRecording = false;
        let activeRecording: CameraVideoRecording | null = null;
        const stop = (): void => {
            if (stopped) return;
            stopped = true;
            activeRecording?.cancel();
            activeRecording = null;
            signal.removeEventListener('abort', stop);
            stopTracks(stream);
        };
        signal.addEventListener('abort', stop, { once: true });

        return {
            stream,
            stop,
            startVideoRecording: async () => {
                if (stopped) {
                    throw new AppError('INVALID_INPUT', 'The camera is no longer active');
                }
                if (activeRecording || preparingVideoRecording) {
                    throw new AppError('INVALID_INPUT', 'Video recording is already active');
                }
                if (!globalThis.MediaRecorder) {
                    throw new AppError(
                        'NOT_IMPLEMENTED',
                        'Video recording is not supported on this device'
                    );
                }

                preparingVideoRecording = true;
                let audioStream: MediaStream;
                try {
                    audioStream = await getUserMedia.call(globalThis.navigator.mediaDevices, {
                        audio: true
                    });
                } catch (error) {
                    if (signal.aborted) signal.throwIfAborted();
                    throw new AppError('INVALID_INPUT', 'Could not access the microphone', error);
                } finally {
                    preparingVideoRecording = false;
                }

                const audioTracks = audioStream.getTracks();
                if (stopped || signal.aborted) {
                    stopTracks(audioStream);
                    signal.throwIfAborted();
                    throw new AppError('INVALID_INPUT', 'The camera is no longer active');
                }

                const addedAudioTracks: MediaStreamTrack[] = [];
                try {
                    for (const track of audioTracks) {
                        stream.addTrack(track);
                        addedAudioTracks.push(track);
                    }
                } catch (error) {
                    for (const track of addedAudioTracks) stream.removeTrack(track);
                    stopTracks(audioStream);
                    throw new AppError(
                        'ASSET_ERROR',
                        'Could not prepare audio for video recording',
                        error
                    );
                }
                let audioReleased = false;
                const releaseAudio = (): void => {
                    if (audioReleased) return;
                    audioReleased = true;
                    for (const track of audioTracks) {
                        stream.removeTrack(track);
                        track.stop();
                    }
                    activeRecording = null;
                };
                try {
                    const recording = createVideoRecording(stream, releaseAudio);
                    activeRecording = recording;
                    return recording;
                } catch (error) {
                    releaseAudio();
                    throw error;
                }
            },
            takePhoto: async (video) => {
                if (stopped) {
                    throw new AppError('INVALID_INPUT', 'The camera is no longer active');
                }
                return captureVideoFrame(video);
            }
        };
    }

    pickPhoto(): Promise<File | null> {
        return pickCapturedFile('image/*');
    }

    pickVideo(): Promise<File | null> {
        return pickCapturedFile('video/*');
    }
}

function createVideoRecording(stream: MediaStream, onSettled: () => void): CameraVideoRecording {
    const MediaRecorderClass = globalThis.MediaRecorder;
    if (!MediaRecorderClass) {
        throw new AppError('NOT_IMPLEMENTED', 'Video recording is not supported on this device');
    }

    const selectedMimeType = selectVideoMimeType(MediaRecorderClass);
    let recorder: MediaRecorder;
    try {
        recorder = new MediaRecorderClass(stream, {
            ...(selectedMimeType ? { mimeType: selectedMimeType } : {}),
            videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
            audioBitsPerSecond: AUDIO_BITS_PER_SECOND
        });
    } catch (error) {
        throw new AppError('NOT_IMPLEMENTED', 'Could not start video recording', error);
    }

    const chunks: Blob[] = [];
    let settled = false;
    let finishPromise: Promise<File> | null = null;
    let rejectPendingFinish: ((error: unknown) => void) | null = null;
    let clearPendingTransition: (() => void) | null = null;
    let rejectPendingTransition: ((error: unknown) => void) | null = null;
    let recordingState: 'recording' | 'paused' = 'recording';
    let rejectFailure!: (error: unknown) => void;
    const failure = new Promise<never>((_resolve, reject) => {
        rejectFailure = reject;
    });

    const handleData = (event: BlobEvent): void => {
        if (event.data.size > 0) chunks.push(event.data);
    };
    const cleanup = (): void => {
        const rejectTransition = rejectPendingTransition;
        clearPendingTransition?.();
        clearPendingTransition = null;
        rejectPendingTransition = null;
        rejectTransition?.(new DOMException('Video recording ended', 'AbortError'));
        recorder.removeEventListener('dataavailable', handleData);
        recorder.removeEventListener('error', handleError);
        onSettled();
    };
    const handleError = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (recorder.state !== 'inactive') recorder.stop();
        rejectFailure(new AppError('ASSET_ERROR', 'Video recording failed'));
    };

    recorder.addEventListener('dataavailable', handleData);
    recorder.addEventListener('error', handleError);
    try {
        recorder.start(250);
    } catch (error) {
        settled = true;
        cleanup();
        throw new AppError('ASSET_ERROR', 'Video recording failed to start', error);
    }

    const cancel = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        chunks.length = 0;
        rejectPendingFinish?.(new DOMException('Video recording was cancelled', 'AbortError'));
        rejectPendingFinish = null;
        if (recorder.state !== 'inactive') recorder.stop();
    };

    const changeRecordingState = (
        eventName: 'pause' | 'resume',
        targetState: 'recording' | 'paused',
        action: () => void,
        errorMessage: string
    ): Promise<void> => {
        if (settled) {
            return Promise.reject(
                new AppError('INVALID_INPUT', 'Video recording is no longer active')
            );
        }
        if (clearPendingTransition) {
            return Promise.reject(
                new AppError('INVALID_INPUT', 'Video recording state is already changing')
            );
        }
        if (recordingState === targetState) return Promise.resolve();

        return new Promise<void>((resolve, reject) => {
            let completed = false;
            const clear = (): void => {
                recorder.removeEventListener(eventName, handleChange);
                if (clearPendingTransition === clear) clearPendingTransition = null;
                rejectPendingTransition = null;
            };
            const handleChange = (): void => {
                if (completed) return;
                completed = true;
                recordingState = targetState;
                clear();
                resolve();
            };
            const rejectTransition = (error: unknown): void => {
                if (completed) return;
                completed = true;
                clear();
                reject(error);
            };
            clearPendingTransition = clear;
            rejectPendingTransition = rejectTransition;
            recorder.addEventListener(eventName, handleChange, { once: true });
            try {
                action();
            } catch (error) {
                rejectTransition(new AppError('ASSET_ERROR', errorMessage, error));
            }
        });
    };

    return {
        failure,
        cancel,
        pause: () =>
            changeRecordingState(
                'pause',
                'paused',
                () => recorder.pause(),
                'Could not pause video recording'
            ),
        resume: () =>
            changeRecordingState(
                'resume',
                'recording',
                () => recorder.resume(),
                'Could not resume video recording'
            ),
        finish: async () => {
            if (finishPromise) return finishPromise;
            if (settled) {
                throw new AppError('ASSET_ERROR', 'Video recording is no longer active');
            }

            const stopped = new Promise<File>((resolve, reject) => {
                rejectPendingFinish = reject;
                const handleStop = (): void => {
                    if (settled) return;
                    settled = true;
                    rejectPendingFinish = null;
                    cleanup();
                    if (chunks.length === 0) {
                        reject(new AppError('ASSET_ERROR', 'Video recording was empty'));
                        return;
                    }
                    try {
                        const mimeType = normalizeVideoMimeType(
                            recorder.mimeType || chunks[0]?.type || selectedMimeType
                        );
                        const blob = new Blob(chunks, { type: mimeType });
                        resolve(
                            new File([blob], createVideoName(mimeType), {
                                type: mimeType,
                                lastModified: Date.now()
                            })
                        );
                    } catch (error) {
                        reject(error);
                    }
                };
                recorder.addEventListener('stop', handleStop, { once: true });
                if (recorder.state === 'inactive') handleStop();
                else recorder.stop();
            });
            finishPromise = Promise.race([stopped, failure]);
            return finishPromise;
        }
    };
}

function selectVideoMimeType(MediaRecorderClass: typeof MediaRecorder): string | undefined {
    if (typeof MediaRecorderClass.isTypeSupported !== 'function') return undefined;
    return VIDEO_MIME_TYPES.find((type) => MediaRecorderClass.isTypeSupported(type));
}

function normalizeVideoMimeType(mimeType: string | undefined): 'video/webm' | 'video/mp4' {
    const normalized = mimeType?.trim().toLowerCase().split(';', 1)[0];
    if (normalized === 'video/webm' || normalized === 'video/mp4') return normalized;
    throw new AppError('NOT_IMPLEMENTED', 'The recorded video format is not supported');
}

function createVideoName(mimeType: 'video/webm' | 'video/mp4'): string {
    const extension = mimeType === 'video/mp4' ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `Video ${timestamp}.${extension}`;
}

function pickCapturedFile(accept: 'image/*' | 'video/*'): Promise<File | null> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.setAttribute('capture', 'environment');
        input.hidden = true;

        let settled = false;
        let focusTimer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = (): void => {
            if (focusTimer) clearTimeout(focusTimer);
            input.removeEventListener('change', handleChange);
            input.removeEventListener('cancel', handleCancel);
            window.removeEventListener('focus', handleWindowFocus);
            input.remove();
        };
        const settle = (file: File | null): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(file);
        };
        const handleChange = (): void => settle(input.files?.[0] ?? null);
        const handleCancel = (): void => settle(null);
        const handleWindowFocus = (): void => {
            if (focusTimer) clearTimeout(focusTimer);
            focusTimer = setTimeout(() => {
                focusTimer = null;
                if (!input.files?.length) settle(null);
            }, FILE_PICKER_FOCUS_SETTLE_MS);
        };

        input.addEventListener('change', handleChange);
        input.addEventListener('cancel', handleCancel);
        window.addEventListener('focus', handleWindowFocus);
        document.body.appendChild(input);
        try {
            input.click();
        } catch (error) {
            settled = true;
            cleanup();
            reject(error);
        }
    });
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<File> {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
        throw new AppError('INVALID_INPUT', 'Camera preview is not ready');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new AppError('NOT_IMPLEMENTED', 'Could not capture a photo on this device');
    }
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (value) => {
                if (value) resolve(value);
                else reject(new AppError('ASSET_ERROR', 'Could not create the captured photo'));
            },
            PHOTO_MIME_TYPE,
            PHOTO_QUALITY
        );
    });

    return new File([blob], createPhotoName(), {
        type: PHOTO_MIME_TYPE,
        lastModified: Date.now()
    });
}

function createPhotoName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `Photo ${timestamp}.jpg`;
}

function stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
}
