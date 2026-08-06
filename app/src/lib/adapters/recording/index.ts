import { isTauri } from '@tauri-apps/api/core';
import { TauriAudioRecorderAdapter } from './tauri';
import { WebAudioRecorderAdapter } from './web';

export type {
    AudioRecorderAdapter,
    AudioRecording,
    RecordedAudio,
    StartAudioRecordingOptions
} from './types';

export const appAudioRecorder = isTauri()
    ? new TauriAudioRecorderAdapter()
    : new WebAudioRecorderAdapter();
