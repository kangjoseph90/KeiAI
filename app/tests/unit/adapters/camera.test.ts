import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCameraAdapter } from '$lib/adapters/camera/web';

class FakeVideoRecorder extends EventTarget {
    static instance: FakeVideoRecorder | null = null;
    static isTypeSupported = vi.fn((type: string) => type === 'video/webm;codecs=vp9,opus');

    state: RecordingState = 'inactive';
    mimeType: string;

    constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions
    ) {
        super();
        this.mimeType = options?.mimeType ?? 'video/webm';
        FakeVideoRecorder.instance = this;
    }

    start = vi.fn(() => {
        this.state = 'recording';
    });

    pause = vi.fn(() => {
        if (this.state !== 'recording')
            throw new DOMException('Invalid state', 'InvalidStateError');
        this.state = 'paused';
        this.dispatchEvent(new Event('pause'));
    });

    resume = vi.fn(() => {
        if (this.state !== 'paused') throw new DOMException('Invalid state', 'InvalidStateError');
        this.state = 'recording';
        this.dispatchEvent(new Event('resume'));
    });

    stop = vi.fn(() => {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        for (const value of ['video-', 'data']) {
            const event = Object.assign(new Event('dataavailable'), {
                data: new Blob([value], { type: this.mimeType })
            });
            this.dispatchEvent(event);
        }
        this.dispatchEvent(new Event('stop'));
    });
}

function createMutableStream(initialTracks: Array<{ stop: ReturnType<typeof vi.fn> }>): {
    stream: MediaStream;
    addTrack: ReturnType<typeof vi.fn>;
    removeTrack: ReturnType<typeof vi.fn>;
} {
    const tracks = [...initialTracks];
    const addTrack = vi.fn((track: { stop: ReturnType<typeof vi.fn> }) => {
        tracks.push(track);
    });
    const removeTrack = vi.fn((track: { stop: ReturnType<typeof vi.fn> }) => {
        const index = tracks.indexOf(track);
        if (index >= 0) tracks.splice(index, 1);
    });
    return {
        stream: {
            getTracks: () => tracks,
            addTrack,
            removeTrack
        } as unknown as MediaStream,
        addTrack,
        removeTrack
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeVideoRecorder.instance = null;
    FakeVideoRecorder.isTypeSupported.mockClear();
});

describe('WebCameraAdapter', () => {
    it('captures the current video frame as a JPEG and releases the camera', async () => {
        const track = { stop: vi.fn() };
        const stream = { getTracks: () => [track] } as unknown as MediaStream;
        const getUserMedia = vi.fn().mockResolvedValue(stream);
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

        const drawImage = vi.fn();
        const context = { drawImage } as unknown as CanvasRenderingContext2D;
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn().mockReturnValue(context),
            toBlob: vi.fn((callback: BlobCallback) => {
                callback(new Blob(['photo'], { type: 'image/jpeg' }));
            })
        } as unknown as HTMLCanvasElement;
        vi.spyOn(document, 'createElement').mockReturnValue(canvas);

        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });
        const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;
        const photo = await capture.takePhoto(video);

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        expect(capture.stream).toBe(stream);
        expect(canvas.width).toBe(1280);
        expect(canvas.height).toBe(720);
        expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
        expect(photo).toBeInstanceOf(File);
        expect(photo.type).toBe('image/jpeg');
        expect(photo.name).toMatch(/^Photo .+\.jpg$/);
        expect(await photo.text()).toBe('photo');

        capture.stop();
        capture.stop();
        expect(track.stop).toHaveBeenCalledOnce();
    });

    it('releases the stream when the capture signal is aborted', async () => {
        const track = { stop: vi.fn() };
        const stream = { getTracks: () => [track] } as unknown as MediaStream;
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }
        });
        const controller = new AbortController();

        const capture = await new WebCameraAdapter().start({ signal: controller.signal });
        controller.abort();

        expect(track.stop).toHaveBeenCalledOnce();
        await expect(
            capture.takePhoto({ videoWidth: 640, videoHeight: 480 } as HTMLVideoElement)
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('records video with audio and normalizes the codec MIME for attachment', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        const audioStream = { getTracks: () => [audioTrack] } as unknown as MediaStream;
        const getUserMedia = vi
            .fn()
            .mockResolvedValueOnce(camera.stream)
            .mockResolvedValueOnce(audioStream);
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);

        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });
        const recording = await capture.startVideoRecording();
        const video = await recording.finish();

        expect(getUserMedia).toHaveBeenNthCalledWith(1, {
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
        expect(camera.addTrack).toHaveBeenCalledWith(audioTrack);
        expect(FakeVideoRecorder.instance?.options).toMatchObject({
            mimeType: 'video/webm;codecs=vp9,opus',
            videoBitsPerSecond: 4_000_000,
            audioBitsPerSecond: 128_000
        });
        expect(FakeVideoRecorder.instance?.start).toHaveBeenCalledWith(250);
        expect(video.type).toBe('video/webm');
        expect(video.name).toMatch(/^Video .+\.webm$/);
        expect(await video.text()).toBe('video-data');
        expect(camera.removeTrack).toHaveBeenCalledWith(audioTrack);
        expect(audioTrack.stop).toHaveBeenCalledOnce();

        capture.stop();
        expect(videoTrack.stop).toHaveBeenCalledOnce();
    });

    it('pauses and resumes an active video recording', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi
                    .fn()
                    .mockResolvedValueOnce(camera.stream)
                    .mockResolvedValueOnce({ getTracks: () => [audioTrack] })
            }
        });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });
        const recording = await capture.startVideoRecording();

        await recording.pause();
        expect(FakeVideoRecorder.instance?.pause).toHaveBeenCalledOnce();
        expect(FakeVideoRecorder.instance?.state).toBe('paused');
        await recording.pause();
        expect(FakeVideoRecorder.instance?.pause).toHaveBeenCalledOnce();

        await recording.resume();
        expect(FakeVideoRecorder.instance?.resume).toHaveBeenCalledOnce();
        expect(FakeVideoRecorder.instance?.state).toBe('recording');
        await recording.resume();
        expect(FakeVideoRecorder.instance?.resume).toHaveBeenCalledOnce();

        await recording.finish();
        capture.stop();
    });

    it('cancels an active video recording when the camera session stops', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi
                    .fn()
                    .mockResolvedValueOnce(camera.stream)
                    .mockResolvedValueOnce({ getTracks: () => [audioTrack] })
            }
        });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });

        const recording = await capture.startVideoRecording();
        await recording.pause();
        capture.stop();
        capture.stop();

        expect(FakeVideoRecorder.instance?.pause).toHaveBeenCalledOnce();
        expect(FakeVideoRecorder.instance?.stop).toHaveBeenCalledOnce();
        expect(videoTrack.stop).toHaveBeenCalledOnce();
        expect(audioTrack.stop).toHaveBeenCalledOnce();
    });

    it('rejects a pending video finish when the camera session closes', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi
                    .fn()
                    .mockResolvedValueOnce(camera.stream)
                    .mockResolvedValueOnce({ getTracks: () => [audioTrack] })
            }
        });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });
        const recording = await capture.startVideoRecording();
        FakeVideoRecorder.instance?.stop.mockImplementation(() => {
            if (FakeVideoRecorder.instance) FakeVideoRecorder.instance.state = 'inactive';
        });

        const finish = recording.finish();
        capture.stop();

        await expect(finish).rejects.toMatchObject({ name: 'AbortError' });
        expect(videoTrack.stop).toHaveBeenCalledOnce();
        expect(audioTrack.stop).toHaveBeenCalledOnce();
    });

    it('reports recorder failures and leaves camera track cleanup to the session', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi
                    .fn()
                    .mockResolvedValueOnce(camera.stream)
                    .mockResolvedValueOnce({ getTracks: () => [audioTrack] })
            }
        });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });
        const recording = await capture.startVideoRecording();
        const failure = expect(recording.failure).rejects.toMatchObject({
            code: 'ASSET_ERROR'
        });

        FakeVideoRecorder.instance?.dispatchEvent(new Event('error'));

        await failure;
        expect(FakeVideoRecorder.instance?.stop).toHaveBeenCalledOnce();
        expect(videoTrack.stop).not.toHaveBeenCalled();
        expect(audioTrack.stop).toHaveBeenCalledOnce();
        capture.stop();
        expect(videoTrack.stop).toHaveBeenCalledOnce();
    });

    it('reports unsupported video recording environments without closing the preview', async () => {
        const track = { stop: vi.fn() };
        const stream = { getTracks: () => [track] } as unknown as MediaStream;
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }
        });
        vi.stubGlobal('MediaRecorder', undefined);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });

        await expect(capture.startVideoRecording()).rejects.toMatchObject({
            code: 'NOT_IMPLEMENTED'
        });
        expect(track.stop).not.toHaveBeenCalled();
        capture.stop();
    });

    it('releases microphone tracks when they cannot be added to the camera stream', async () => {
        const videoTrack = { stop: vi.fn() };
        const audioTrack = { stop: vi.fn() };
        const camera = createMutableStream([videoTrack]);
        camera.addTrack.mockImplementationOnce(() => {
            throw new Error('track rejected');
        });
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi
                    .fn()
                    .mockResolvedValueOnce(camera.stream)
                    .mockResolvedValueOnce({ getTracks: () => [audioTrack] })
            }
        });
        vi.stubGlobal('MediaRecorder', FakeVideoRecorder);
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });

        await expect(capture.startVideoRecording()).rejects.toMatchObject({
            code: 'ASSET_ERROR'
        });
        expect(audioTrack.stop).toHaveBeenCalledOnce();
        expect(videoTrack.stop).not.toHaveBeenCalled();

        capture.stop();
        expect(videoTrack.stop).toHaveBeenCalledOnce();
    });

    it('rejects capture until the video preview has dimensions', async () => {
        const stream = { getTracks: () => [] } as unknown as MediaStream;
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }
        });
        const capture = await new WebCameraAdapter().start({
            signal: new AbortController().signal
        });

        await expect(
            capture.takePhoto({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('reports unsupported and denied camera access', async () => {
        vi.stubGlobal('navigator', {});
        await expect(
            new WebCameraAdapter().start({ signal: new AbortController().signal })
        ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });

        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) }
        });
        await expect(
            new WebCameraAdapter().start({ signal: new AbortController().signal })
        ).rejects.toMatchObject({
            code: 'INVALID_INPUT',
            message: 'Could not access the camera'
        });
    });

    it('opens the system image capture picker as a fallback', async () => {
        const photo = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' });
        const input = document.createElement('input');
        const remove = vi.spyOn(input, 'remove');
        vi.spyOn(input, 'click').mockImplementation(() => {
            Object.defineProperty(input, 'files', { value: [photo], configurable: true });
            input.dispatchEvent(new Event('change'));
        });
        vi.spyOn(document, 'createElement').mockReturnValue(input);

        const selected = await new WebCameraAdapter().pickPhoto();

        expect(input.type).toBe('file');
        expect(input.accept).toBe('image/*');
        expect(input.getAttribute('capture')).toBe('environment');
        expect(selected).toBe(photo);
        expect(remove).toHaveBeenCalledOnce();
    });

    it('opens the system video capture picker as a fallback', async () => {
        const video = new File(['video'], 'camera.webm', { type: 'video/webm' });
        const input = document.createElement('input');
        vi.spyOn(input, 'click').mockImplementation(() => {
            Object.defineProperty(input, 'files', { value: [video], configurable: true });
            input.dispatchEvent(new Event('change'));
        });
        vi.spyOn(document, 'createElement').mockReturnValue(input);

        const selected = await new WebCameraAdapter().pickVideo();

        expect(input.accept).toBe('video/*');
        expect(input.getAttribute('capture')).toBe('environment');
        expect(selected).toBe(video);
    });
});
