import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fromPretrained: vi.fn(),
    generate: vi.fn(),
    dispose: vi.fn()
}));

vi.mock('kokoro-js', () => ({
    KokoroTTS: { from_pretrained: mocks.fromPretrained }
}));

import { KokoroInference } from '$lib/inference/kokoro';

describe('KokoroInference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.generate.mockResolvedValue({
            toWav: () => new Uint8Array([82, 73, 70, 70]).buffer
        });
        mocks.dispose.mockResolvedValue(undefined);
        mocks.fromPretrained.mockResolvedValue({
            generate: mocks.generate,
            model: { dispose: mocks.dispose }
        });
    });

    it('loads Kokoro once and returns WAV bytes for repeated synthesis', async () => {
        const inference = new KokoroInference();
        const signal = new AbortController().signal;

        await expect(inference.synthesize('hello', 'af_heart', signal)).resolves.toEqual(
            new Uint8Array([82, 73, 70, 70])
        );
        await inference.synthesize('again', 'af_heart', signal);

        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
            dtype: 'q8',
            device: 'wasm'
        });
        expect(mocks.generate).toHaveBeenNthCalledWith(1, 'hello', { voice: 'af_heart' });
        expect(mocks.generate).toHaveBeenNthCalledWith(2, 'again', { voice: 'af_heart' });
    });

    it('rejects before loading when already aborted', async () => {
        const inference = new KokoroInference();
        const controller = new AbortController();
        controller.abort();

        await expect(
            inference.synthesize('hello', 'af_heart', controller.signal)
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.fromPretrained).not.toHaveBeenCalled();
    });

    it('disposes the loaded model', async () => {
        const inference = new KokoroInference();
        await inference.synthesize('hello', 'af_heart', new AbortController().signal);

        await inference.dispose();

        expect(mocks.dispose).toHaveBeenCalledOnce();
    });
});
