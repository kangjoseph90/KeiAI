import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioRecorderAdapter } from '$lib/adapters/recording/web';

class FakeMediaRecorder extends EventTarget {
    static instance: FakeMediaRecorder | null = null;
    static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus');

    state: RecordingState = 'inactive';
    mimeType: string;

    constructor(
        readonly stream: MediaStream,
        options?: MediaRecorderOptions
    ) {
        super();
        this.mimeType = options?.mimeType ?? 'audio/webm';
        FakeMediaRecorder.instance = this;
    }

    start = vi.fn(() => {
        this.state = 'recording';
    });

    stop = vi.fn(() => {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        const event = Object.assign(new Event('dataavailable'), {
            data: new Blob(['audio'], { type: this.mimeType })
        });
        this.dispatchEvent(event);
        this.dispatchEvent(new Event('stop'));
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    FakeMediaRecorder.instance = null;
    FakeMediaRecorder.isTypeSupported.mockClear();
});

describe('WebAudioRecorderAdapter', () => {
    it('records supported audio and releases the microphone on finish', async () => {
        const track = { stop: vi.fn() };
        const stream = { getTracks: () => [track] } as unknown as MediaStream;
        const getUserMedia = vi.fn().mockResolvedValue(stream);
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
        vi.stubGlobal('AudioContext', undefined);

        const recording = await new WebAudioRecorderAdapter().start({
            signal: new AbortController().signal
        });
        const result = await recording.finish();

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(FakeMediaRecorder.instance?.start).toHaveBeenCalledWith(250);
        expect(result.mimeType).toBe('audio/webm;codecs=opus');
        expect(result.data.length).toBeGreaterThan(0);
        expect(track.stop).toHaveBeenCalledOnce();
    });

    it('reports unsupported recording environments', async () => {
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('MediaRecorder', undefined);

        await expect(
            new WebAudioRecorderAdapter().start({ signal: new AbortController().signal })
        ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    });
});
