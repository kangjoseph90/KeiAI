import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriAudioRecorderAdapter } from '$lib/adapters/recording/tauri';

interface FakeChannel<T> {
    onmessage: (message: T) => void;
}

interface RecordingEvent {
    kind: 'level' | 'error';
    level?: number;
    message?: string;
}

const native = vi.hoisted(() => ({
    invoke: vi.fn(),
    channels: [] as Array<{ onmessage: (message: unknown) => void }>
}));

vi.mock('@tauri-apps/api/core', () => ({
    isTauri: () => false,
    invoke: native.invoke,
    Channel: class<T> {
        onmessage = (_message: T): void => undefined;

        constructor() {
            native.channels.push(this as { onmessage: (message: unknown) => void });
        }
    }
}));

describe('TauriAudioRecorderAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        native.channels.length = 0;
        native.invoke.mockImplementation(async (command: string) => {
            if (command === 'finish_audio_recording') {
                return new Uint8Array([82, 73, 70, 70]).buffer;
            }
            return undefined;
        });
    });

    it('streams native levels and returns WAV bytes on finish', async () => {
        const onLevel = vi.fn();
        const recording = await new TauriAudioRecorderAdapter().start({
            signal: new AbortController().signal,
            onLevel
        });
        const channel = native.channels[0] as FakeChannel<RecordingEvent>;

        channel.onmessage({ kind: 'level', level: 0.42 });
        const result = await recording.finish();

        expect(onLevel).toHaveBeenCalledWith(0.42);
        expect(native.invoke).toHaveBeenNthCalledWith(
            1,
            'start_audio_recording',
            expect.objectContaining({ recordingId: expect.any(String), events: channel })
        );
        expect(native.invoke).toHaveBeenNthCalledWith(2, 'finish_audio_recording', {
            recordingId: expect.any(String)
        });
        expect(result).toEqual({
            data: new Uint8Array([82, 73, 70, 70]),
            mimeType: 'audio/wav'
        });
    });

    it('cancels the native stream when aborted', async () => {
        const controller = new AbortController();
        await new TauriAudioRecorderAdapter().start({ signal: controller.signal });

        controller.abort();

        await vi.waitFor(() => {
            expect(native.invoke).toHaveBeenLastCalledWith('cancel_audio_recording', {
                recordingId: expect.any(String)
            });
        });
    });

    it('rejects the failure channel and releases a failed native stream', async () => {
        const recording = await new TauriAudioRecorderAdapter().start({
            signal: new AbortController().signal
        });
        const channel = native.channels[0] as FakeChannel<RecordingEvent>;
        const failure = expect(recording.failure).rejects.toMatchObject({
            code: 'ASSET_ERROR',
            message: 'device disconnected'
        });

        channel.onmessage({ kind: 'error', message: 'device disconnected' });

        await failure;
        await vi.waitFor(() => {
            expect(native.invoke).toHaveBeenLastCalledWith('cancel_audio_recording', {
                recordingId: expect.any(String)
            });
        });
    });
});
