export type CameraMode = 'photo' | 'video';

export interface StartCameraOptions {
    signal: AbortSignal;
}

export interface CameraVideoRecording {
    readonly failure: Promise<never>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    finish(): Promise<File>;
    cancel(): void;
}

export interface CameraCapture {
    readonly stream: MediaStream;
    takePhoto(video: HTMLVideoElement): Promise<File>;
    startVideoRecording(): Promise<CameraVideoRecording>;
    stop(): void;
}

export interface CameraAdapter {
    start(options: StartCameraOptions): Promise<CameraCapture>;
    pickPhoto(): Promise<File | null>;
    pickVideo(): Promise<File | null>;
}
