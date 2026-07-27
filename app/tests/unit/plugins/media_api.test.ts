import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager, type PluginInstance } from '$lib/plugins/manager';

const mocks = vi.hoisted(() => ({
    generateImage: vi.fn(),
    generateImageInlay: vi.fn(),
    synthesizeSpeech: vi.fn(),
    synthesizeSpeechInlay: vi.fn(),
    transcribeSpeech: vi.fn(),
    transcribeSpeechInlay: vi.fn()
}));

vi.mock('$lib/managers/media', () => mocks);

function createInstance(): PluginInstance {
    return {
        pluginId: 'plugin-1',
        iframe: { remove: vi.fn() } as unknown as HTMLIFrameElement,
        transport: { destroy: vi.fn() } as unknown as PluginInstance['transport'],
        broker: {
            expose: vi.fn(),
            invoke: vi.fn(),
            fireEvent: vi.fn()
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map(),
        macroHandlers: new Map(),
        llmProviders: new Map(),
        llmTypes: new Map(),
        unloadHandlers: []
    };
}

describe('plugin media APIs', () => {
    const exposed = new Map<string, (...args: unknown[]) => unknown>();

    beforeEach(() => {
        vi.clearAllMocks();
        exposed.clear();
        const manager = new PluginManager();
        const instance = createInstance();
        vi.mocked(instance.broker.expose).mockImplementation((name, handler) => {
            exposed.set(name, handler);
        });
        (
            manager as unknown as {
                bindHostAPIs: (value: PluginInstance) => void;
            }
        ).bindHostAPIs(instance);
    });

    it('passes raw media and cancellation to the configured handlers', async () => {
        const signal = new AbortController().signal;
        const reference = { data: new Uint8Array([1]), mimeType: 'image/png' };
        mocks.generateImage.mockResolvedValue({
            data: new Uint8Array([2]),
            mimeType: 'image/png'
        });
        const speech = (async function* () {
            yield { data: new Uint8Array([4]), mimeType: 'audio/wav' };
        })();
        mocks.synthesizeSpeech.mockReturnValue(speech);
        mocks.transcribeSpeech.mockResolvedValue({ text: 'spoken text' });

        await exposed.get('core.generateImage')!('prompt', 'negative', [reference], [], signal);
        expect(exposed.get('core.synthesizeSpeech')!('hello', signal)).toBe(speech);
        await expect(
            exposed.get('core.transcribeSpeech')!(
                { data: new Uint8Array([3]), mimeType: 'audio/wav' },
                signal
            )
        ).resolves.toBe('spoken text');

        expect(mocks.generateImage).toHaveBeenCalledWith(
            {
                prompt: 'prompt',
                negativePrompt: 'negative',
                referenceImages: [reference],
                styleImages: []
            },
            signal
        );
        expect(mocks.synthesizeSpeech).toHaveBeenCalledWith('hello', signal);
        expect(mocks.transcribeSpeech).toHaveBeenCalledWith(
            expect.objectContaining({ mimeType: 'audio/wav' }),
            signal
        );
    });

    it('binds inlay convenience calls to the requested chat', async () => {
        const signal = new AbortController().signal;
        mocks.generateImageInlay.mockResolvedValue('image-id');
        mocks.synthesizeSpeechInlay.mockResolvedValue('audio-id');
        mocks.transcribeSpeechInlay.mockResolvedValue('text');

        await expect(
            exposed.get('core.generateImageInlay')!(
                'chat-1',
                'prompt',
                undefined,
                ['reference-id'],
                ['style-id'],
                signal
            )
        ).resolves.toBe('image-id');
        await expect(
            exposed.get('core.synthesizeSpeechInlay')!('chat-1', 'hello', signal)
        ).resolves.toBe('audio-id');
        await expect(
            exposed.get('core.transcribeSpeechInlay')!('chat-1', 'audio-id', signal)
        ).resolves.toBe('text');

        expect(mocks.generateImageInlay).toHaveBeenCalledWith(
            'chat-1',
            {
                prompt: 'prompt',
                referenceImageInlayIds: ['reference-id'],
                styleImageInlayIds: ['style-id']
            },
            signal
        );
    });
});
