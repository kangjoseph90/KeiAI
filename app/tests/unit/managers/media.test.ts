import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '$lib/services';
import {
    generateImage,
    generateImageInlay,
    synthesizeSpeechInlay,
    transcribeSpeechInlay
} from '$lib/managers/media';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    getChat: vi.fn(),
    createChatInlay: vi.fn(),
    readBytes: vi.fn(),
    load: vi.fn(),
    selectImage: vi.fn(),
    selectTTS: vi.fn(),
    selectSTT: vi.fn(),
    generate: vi.fn(),
    synthesize: vi.fn(),
    transcribe: vi.fn()
}));

vi.mock('$lib/stores', () => ({
    getAppSettings: mocks.getAppSettings,
    getChat: mocks.getChat,
    createChatInlay: mocks.createChatInlay
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        readBytes: mocks.readBytes,
        load: mocks.load
    }
}));

vi.mock('$lib/imagegen', () => ({
    selectImageGenHandler: mocks.selectImage
}));

vi.mock('$lib/tts', () => ({
    selectTTSHandler: mocks.selectTTS
}));

vi.mock('$lib/stt', () => ({
    selectSTTHandler: mocks.selectSTT
}));

const chat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Test',
    chatNote: '',
    messageCount: 0,
    personas: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} },
    inlays: {
        refs: {
            image: {
                id: 'image',
                sortOrder: 'a',
                name: 'reference.png',
                hash: 'image-hash',
                encKey: 'image-key',
                mimeType: 'image/png'
            },
            audio: {
                id: 'audio',
                sortOrder: 'b',
                name: 'speech.wav',
                hash: 'audio-hash',
                encKey: 'audio-key',
                mimeType: 'audio/wav'
            }
        },
        folders: {}
    }
};

describe('media manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAppSettings.mockResolvedValue({
            imagegenProvider: 'mock',
            ttsProvider: 'mock',
            sttProvider: 'mock'
        });
        mocks.getChat.mockResolvedValue(chat);
        mocks.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        mocks.createChatInlay.mockResolvedValue({ id: 'generated-inlay' });
        mocks.selectImage.mockReturnValue({ generate: mocks.generate });
        mocks.selectTTS.mockReturnValue({ synthesize: mocks.synthesize });
        mocks.selectSTT.mockReturnValue({ transcribe: mocks.transcribe });
    });

    it('returns normalized image bytes from the configured handler', async () => {
        mocks.generate.mockResolvedValue({
            base64: 'AQID',
            mimeType: 'image/png'
        });

        const result = await generateImage(
            {
                prompt: 'portrait',
                referenceImages: [],
                styleImages: []
            },
            new AbortController().signal
        );

        expect(result.mimeType).toBe('image/png');
        expect([...result.data]).toEqual([1, 2, 3]);
    });

    it('resolves image inlays and stores the generated image in the same chat', async () => {
        mocks.generate.mockResolvedValue({
            base64: 'AQID',
            mimeType: 'image/png'
        });

        await expect(
            generateImageInlay(
                chat.id,
                {
                    prompt: 'portrait',
                    referenceImageInlayIds: ['image'],
                    styleImageInlayIds: []
                },
                new AbortController().signal
            )
        ).resolves.toBe('generated-inlay');

        expect(mocks.generate).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: [
                    expect.objectContaining({
                        mimeType: 'image/png'
                    })
                ]
            }),
            expect.any(AbortSignal)
        );
        expect(mocks.createChatInlay).toHaveBeenCalledWith(chat.id, expect.any(File));
    });

    it('stores synthesized audio and transcribes a single audio inlay', async () => {
        mocks.synthesize.mockImplementation(async function* () {
            yield { data: new Uint8Array([1, 2]), mimeType: 'audio/wav' };
            yield { data: new Uint8Array([3]), mimeType: 'audio/wav' };
        });
        mocks.transcribe.mockResolvedValue({ text: 'hello' });

        await expect(
            synthesizeSpeechInlay(chat.id, 'hello', new AbortController().signal)
        ).resolves.toBe('generated-inlay');
        await expect(
            transcribeSpeechInlay(chat.id, 'audio', new AbortController().signal)
        ).resolves.toBe('hello');

        const audioFile = mocks.createChatInlay.mock.calls[0][1] as File;
        expect([...new Uint8Array(await audioFile.arrayBuffer())]).toEqual([1, 2, 3]);
        expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Blob), expect.any(AbortSignal));
    });
});
