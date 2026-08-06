export interface RecordedAudio {
    data: Uint8Array<ArrayBuffer>;
    mimeType: string;
}

export interface AudioRecording {
    failure: Promise<never>;
    finish(): Promise<RecordedAudio>;
    cancel(): void;
}

export interface StartAudioRecordingOptions {
    signal: AbortSignal;
    onLevel?: (level: number) => void;
}

export interface AudioRecorderAdapter {
    start(options: StartAudioRecordingOptions): Promise<AudioRecording>;
}
