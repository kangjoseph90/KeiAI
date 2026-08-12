import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager, type PluginInstance } from '$lib/plugins/manager';

const mocks = vi.hoisted(() => ({
    generateImage: vi.fn(),
    generateImageInlay: vi.fn(),
    synthesizeSpeech: vi.fn(),
    synthesizeSpeechInlay: vi.fn(),
    transcribeSpeech: vi.fn(),
    transcribeSpeechInlay: vi.fn(),
    createInlay: vi.fn(),
    readInlay: vi.fn(),
    listInlays: vi.fn(),
    getRoom: vi.fn(),
    getChat: vi.fn(),
    getMessage: vi.fn(),
    similarity: vi.fn(),
    rerank: vi.fn()
}));

vi.mock('$lib/managers/media', () => mocks);
vi.mock('$lib/managers/retrieval', () => ({
    similarity: mocks.similarity,
    rerank: mocks.rerank
}));
vi.mock('$lib/stores', () => ({
    getRoom: mocks.getRoom,
    getChat: mocks.getChat,
    getMessage: mocks.getMessage
}));

function createInstance(): PluginInstance {
    return {
        pluginId: 'plugin-1',
        pluginName: 'Example Plugin',
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
        imageGenProviders: new Map(),
        ttsProviders: new Map(),
        sttProviders: new Map(),
        embeddingProviders: new Map(),
        rerankerProviders: new Map(),
        llmTypes: new Map(),
        unloadHandlers: []
    };
}

describe('plugin media APIs', () => {
    const exposed = new Map<string, (...args: unknown[]) => unknown>();
    let instance: PluginInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        exposed.clear();
        const manager = new PluginManager();
        instance = createInstance();
        vi.mocked(instance.broker.expose).mockImplementation((name, handler) => {
            exposed.set(name, handler);
        });
        (
            manager as unknown as {
                bindHostAPIs: (value: PluginInstance) => void;
            }
        ).bindHostAPIs(instance);
    });

    it('registers and removes media providers', () => {
        exposed.get('core.addLLMProvider')!('chat', 'llm-fn', {
            name: 'Plugin Chat'
        });
        exposed.get('core.addImageGenProvider')!('images', 'image-fn', {
            name: 'Plugin Images'
        });
        exposed.get('core.addTTSProvider')!('speech', 'tts-fn', { name: 'Plugin Speech' });
        exposed.get('core.addSTTProvider')!('transcription', 'stt-fn', {
            name: 'Plugin Transcription'
        });
        exposed.get('core.addEmbeddingProvider')!('embeddings', 'embedding-fn', {
            name: 'Plugin Embeddings'
        });
        exposed.get('core.addRerankerProvider')!('reranker', 'reranker-fn', {
            name: 'Plugin Reranker'
        });

        expect(instance.llmProviders.get('plugin::Example Plugin::chat')?.model.id).toBe(
            'plugin::Example Plugin::chat'
        );
        expect(instance.imageGenProviders.get('plugin::Example Plugin::images')).toEqual({
            fnId: 'image-fn',
            model: {
                id: 'plugin::Example Plugin::images',
                modelId: 'images',
                name: 'Plugin Images',
                provider: 'plugin'
            }
        });
        expect(instance.ttsProviders.get('plugin::Example Plugin::speech')?.model.id).toBe(
            'plugin::Example Plugin::speech'
        );
        expect(instance.sttProviders.get('plugin::Example Plugin::transcription')?.model.id).toBe(
            'plugin::Example Plugin::transcription'
        );
        expect(instance.embeddingProviders.get('plugin::Example Plugin::embeddings')).toEqual({
            fnId: 'embedding-fn',
            model: {
                id: 'plugin::Example Plugin::embeddings',
                modelId: 'embeddings',
                name: 'Plugin Embeddings',
                provider: 'plugin'
            }
        });
        expect(instance.rerankerProviders.get('plugin::Example Plugin::reranker')?.model.id).toBe(
            'plugin::Example Plugin::reranker'
        );

        exposed.get('core.removeImageGenProvider')!('images', 'other-fn');
        expect(instance.imageGenProviders.has('plugin::Example Plugin::images')).toBe(true);

        exposed.get('core.removeImageGenProvider')!('images', 'image-fn');
        exposed.get('core.removeLLMProvider')!('chat', 'llm-fn');
        exposed.get('core.removeTTSProvider')!('speech', 'tts-fn');
        exposed.get('core.removeSTTProvider')!('transcription', 'stt-fn');
        exposed.get('core.removeEmbeddingProvider')!('embeddings', 'embedding-fn');
        exposed.get('core.removeRerankerProvider')!('reranker', 'reranker-fn');
        expect(instance.imageGenProviders.size).toBe(0);
        expect(instance.llmProviders.size).toBe(0);
        expect(instance.ttsProviders.size).toBe(0);
        expect(instance.sttProviders.size).toBe(0);
        expect(instance.embeddingProviders.size).toBe(0);
        expect(instance.rerankerProviders.size).toBe(0);
    });

    it('passes raw media and cancellation to the configured handlers', async () => {
        const signal = new AbortController().signal;
        const reference = { data: new Uint8Array([1]), mimeType: 'image/png' };
        mocks.generateImage.mockResolvedValue({
            data: new Uint8Array([2]),
            mimeType: 'image/png'
        });
        const speech = { data: new Uint8Array([4]), mimeType: 'audio/wav' };
        mocks.synthesizeSpeech.mockResolvedValue(speech);
        mocks.transcribeSpeech.mockResolvedValue({ text: 'spoken text' });

        await exposed.get('core.generateImage')!('prompt', 'negative', [reference], [], signal);
        await expect(exposed.get('core.synthesizeSpeech')!('hello', signal)).resolves.toBe(speech);
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

    it('passes retrieval input and cancellation to the configured managers', async () => {
        const signal = new AbortController().signal;
        const result = [
            { index: 1, score: 0.9 },
            { index: 0, score: 0.4 }
        ];
        mocks.similarity.mockResolvedValue(result);
        mocks.rerank.mockResolvedValue(result);

        await expect(
            exposed.get('core.similarity')!('query', ['first', 'second'], 1, signal)
        ).resolves.toBe(result);
        await expect(
            exposed.get('core.similarity')!('legacy-query', ['first'], signal)
        ).resolves.toBe(result);
        await expect(
            exposed.get('core.rerank')!('query', ['first', 'second'], signal)
        ).resolves.toBe(result);

        expect(mocks.similarity).toHaveBeenCalledWith('query', ['first', 'second'], signal, 1);
        expect(mocks.similarity).toHaveBeenCalledWith('legacy-query', ['first'], signal, undefined);
        expect(mocks.rerank).toHaveBeenCalledWith('query', ['first', 'second'], signal);
    });

    it('binds resource and raw inlay APIs', async () => {
        const inlay = { id: 'inlay-1', name: 'image.png', mimeType: 'image/png' };
        const inlayData = { ...inlay, data: new Uint8Array([1, 2]) };
        mocks.getRoom.mockResolvedValue({ id: 'room-1' });
        mocks.getChat.mockResolvedValue({ id: 'chat-1' });
        mocks.getMessage.mockResolvedValue({ id: 'message-1' });
        mocks.createInlay.mockResolvedValue(inlay);
        mocks.readInlay.mockResolvedValue(inlayData);
        mocks.listInlays.mockResolvedValue([inlay]);

        await expect(exposed.get('core.getRoom')!('room-1')).resolves.toEqual({ id: 'room-1' });
        await expect(exposed.get('core.getChat')!('chat-1')).resolves.toEqual({ id: 'chat-1' });
        await expect(exposed.get('core.getMessage')!('message-1')).resolves.toEqual({
            id: 'message-1'
        });
        await expect(
            exposed.get('core.createInlay')!('chat-1', {
                name: 'image.png',
                mimeType: 'image/png',
                data: new Uint8Array([1, 2])
            })
        ).resolves.toEqual(inlay);
        await expect(exposed.get('core.readInlay')!('chat-1', 'inlay-1')).resolves.toEqual(
            inlayData
        );
        await expect(exposed.get('core.listInlays')!('chat-1')).resolves.toEqual([inlay]);
    });
});
