import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectImageGenHandler } from '$lib/imagegen';
import { selectSTTHandler } from '$lib/stt';
import { selectTTSHandler } from '$lib/tts';
import type { PluginInstance } from '$lib/plugins/manager';

const mocks = vi.hoisted(() => ({
    instances: [] as PluginInstance[],
    invoke: vi.fn()
}));

vi.mock('$lib/plugins', () => ({
    pluginManager: {
        getInstances: () => mocks.instances
    }
}));

const settings = {
    plugin: {
        imagegen: { modelId: 'plugin::Media Plugin::images' },
        tts: { modelId: 'plugin::Media Plugin::speech' },
        stt: { modelId: 'plugin::Media Plugin::transcription' }
    }
} as Parameters<typeof selectImageGenHandler>[1];

describe('plugin media provider handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const provider = (id: `plugin::${string}`, modelId: string, fnId: string) => ({
            fnId,
            model: {
                id,
                modelId,
                name: modelId,
                provider: 'plugin' as const
            }
        });
        mocks.instances = [
            {
                imageGenProviders: new Map([
                    [
                        'plugin::Media Plugin::images',
                        provider('plugin::Media Plugin::images', 'images', 'image-fn')
                    ]
                ]),
                ttsProviders: new Map([
                    [
                        'plugin::Media Plugin::speech',
                        provider('plugin::Media Plugin::speech', 'speech', 'tts-fn')
                    ]
                ]),
                sttProviders: new Map([
                    [
                        'plugin::Media Plugin::transcription',
                        provider('plugin::Media Plugin::transcription', 'transcription', 'stt-fn')
                    ]
                ]),
                broker: {
                    invoke: mocks.invoke
                }
            } as unknown as PluginInstance
        ];
    });

    it('routes image, speech synthesis, and transcription through plugin RPC', async () => {
        const signal = new AbortController().signal;
        const imageRequest = {
            prompt: 'portrait',
            referenceImages: [],
            styleImages: []
        };
        mocks.invoke
            .mockResolvedValueOnce({
                data: new Uint8Array([1]),
                mimeType: 'image/png'
            })
            .mockResolvedValueOnce({
                data: new Uint8Array([2]),
                mimeType: 'audio/wav'
            })
            .mockResolvedValueOnce({ text: 'transcribed' });

        await expect(
            selectImageGenHandler('plugin', settings)?.generate(imageRequest, signal)
        ).resolves.toEqual({
            data: new Uint8Array([1]),
            mimeType: 'image/png'
        });
        await expect(
            selectTTSHandler('plugin', settings)!.synthesize('hello', signal)
        ).resolves.toEqual({
            data: new Uint8Array([2]),
            mimeType: 'audio/wav'
        });
        await expect(
            selectSTTHandler('plugin', settings)?.transcribe(
                new Blob([new Uint8Array([3])], { type: 'audio/wav' }),
                signal
            )
        ).resolves.toEqual({ text: 'transcribed' });

        expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'image-fn', [imageRequest], signal);
        expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'tts-fn', ['hello'], signal);
        expect(mocks.invoke).toHaveBeenNthCalledWith(
            3,
            'stt-fn',
            [{ data: new Uint8Array([3]), mimeType: 'audio/wav' }],
            signal
        );
    });
});
