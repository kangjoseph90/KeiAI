import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NovelAIImageGenHandler } from '$lib/imagegen/handlers/novelai';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    fetch: vi.fn()
}));

vi.mock('$lib/adapters/cache', () => ({
    createAsyncCache: () => ({
        get: mocks.get,
        set: mocks.set
    })
}));

vi.mock('$lib/adapters/http', () => ({
    appHttp: {
        fetch: mocks.fetch
    }
}));

function createHandler(): NovelAIImageGenHandler {
    return new NovelAIImageGenHandler({
        apiKey: 'key',
        baseUrl: 'https://image.example',
        modelId: 'nai-model',
        width: 832,
        height: 1216,
        sampler: 'k_euler',
        noiseSchedule: 'karras',
        steps: 28,
        scale: 6,
        cfgRescale: 0,
        vibeInformationExtracted: 1,
        vibeStrength: 0.7,
        referenceStrength: 1,
        referenceFidelity: 1
    });
}

function generationResponse(): Response {
    return new Response(JSON.stringify({ images: [{ image: 'AQID' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

describe('NovelAI vibe encoding cache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.set.mockResolvedValue(undefined);
    });

    it('uses a cached vibe encoding without calling the encode endpoint', async () => {
        mocks.get.mockResolvedValue('cached-encoding');
        mocks.fetch.mockResolvedValue(generationResponse());

        await expect(
            createHandler().generate({
                prompt: 'portrait',
                referenceImages: [],
                styleImages: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }]
            })
        ).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });

        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        expect(mocks.fetch.mock.calls[0][0]).toBe('https://image.example/ai/generate-image');
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('stores a newly encoded vibe', async () => {
        mocks.get.mockResolvedValue(undefined);
        mocks.fetch
            .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200 }))
            .mockResolvedValueOnce(generationResponse());

        await createHandler().generate({
            prompt: 'portrait',
            referenceImages: [],
            styleImages: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }]
        });

        expect(mocks.fetch.mock.calls[0][0]).toBe('https://image.example/ai/encode-vibe');
        expect(mocks.set).toHaveBeenCalledWith(expect.any(String), 'BAUG');
    });
});
