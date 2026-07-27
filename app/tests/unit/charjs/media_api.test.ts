import { afterEach, describe, expect, it, vi } from 'vitest';
import { destroyAllInstances, getOrCreateInstance, invokeHandler } from '$lib/charjs';
import type { CharJS } from '$lib/services';

const mocks = vi.hoisted(() => ({
    generateImageInlay: vi.fn().mockResolvedValue('generated-image'),
    synthesizeSpeechInlay: vi.fn().mockResolvedValue('generated-audio'),
    transcribeSpeechInlay: vi.fn().mockResolvedValue('transcribed text')
}));

vi.mock('$lib/managers/media', () => ({
    generateImageInlay: mocks.generateImageInlay,
    synthesizeSpeechInlay: mocks.synthesizeSpeechInlay,
    transcribeSpeechInlay: mocks.transcribeSpeechInlay
}));

vi.mock('$lib/managers/chat', () => ({
    getChatVariable: vi.fn(),
    setChatVariable: vi.fn()
}));

const script: CharJS = {
    id: 'media-script',
    sortOrder: 'a',
    name: 'Media Script',
    enabled: true,
    code: `
        KeiAPI.onPipeline('display', async () => {
            const image = await KeiAPI.generateImage(
                'portrait',
                'blurry',
                ['reference-id'],
                ['style-id']
            );
            const audio = await KeiAPI.synthesizeSpeech('hello');
            const text = await KeiAPI.transcribeSpeech('audio-id');
            return JSON.stringify({ image, audio, text });
        });
    `
};

describe('CharJS media APIs', () => {
    afterEach(() => {
        destroyAllInstances();
        vi.clearAllMocks();
    });

    it('uses the current chat and exchanges inlay IDs', async () => {
        const instance = await getOrCreateInstance('chat-1', script, 'pipe', 'display', true);
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBe(
            JSON.stringify({
                image: 'generated-image',
                audio: 'generated-audio',
                text: 'transcribed text'
            })
        );

        expect(mocks.generateImageInlay).toHaveBeenCalledWith(
            'chat-1',
            {
                prompt: 'portrait',
                negativePrompt: 'blurry',
                referenceImageInlayIds: ['reference-id'],
                styleImageInlayIds: ['style-id']
            },
            expect.any(AbortSignal)
        );
        expect(mocks.synthesizeSpeechInlay).toHaveBeenCalledWith(
            'chat-1',
            'hello',
            expect.any(AbortSignal)
        );
        expect(mocks.transcribeSpeechInlay).toHaveBeenCalledWith(
            'chat-1',
            'audio-id',
            expect.any(AbortSignal)
        );
    });
});
