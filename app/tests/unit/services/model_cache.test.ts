import { describe, expect, it, vi } from 'vitest';
import { TransformersModelCacheService, parseModelUrl } from '$lib/services/model_cache';

describe('TransformersModelCacheService', () => {
    it('groups cached Hugging Face files and ignores unrelated runtime files', async () => {
        const storage = fakeCacheStorage({
            'transformers-cache': fakeCache([
                [
                    'https://huggingface.co/onnx-community/LFM2.5-350M-ONNX/resolve/main/config.json',
                    responseWithSize(100)
                ],
                [
                    'https://huggingface.co/onnx-community/LFM2.5-350M-ONNX/resolve/main/onnx/model_q8.onnx',
                    responseWithSize(400)
                ],
                [
                    'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm.wasm',
                    responseWithSize(900)
                ],
                [
                    'https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/model.onnx',
                    new Response('model')
                ]
            ]).cache
        });
        const service = new TransformersModelCacheService(storage, directMutation);

        await expect(service.inspect()).resolves.toEqual({
            available: true,
            models: [
                {
                    key: 'onnx-community/LFM2.5-350M-ONNX@main',
                    modelId: 'onnx-community/LFM2.5-350M-ONNX',
                    revision: 'main',
                    name: 'LFM2.5-350M-ONNX',
                    fileCount: 2,
                    sizeBytes: 500,
                    sizeKnown: true
                },
                {
                    key: 'onnx-community/moonshine-tiny-ONNX@main',
                    modelId: 'onnx-community/moonshine-tiny-ONNX',
                    revision: 'main',
                    name: 'moonshine-tiny-ONNX',
                    fileCount: 1,
                    sizeBytes: 0,
                    sizeKnown: false
                }
            ],
            totalBytes: 500,
            totalSizeKnown: false
        });
    });

    it('deletes selected model files from every known cache bucket', async () => {
        const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
        const modelUrl = `https://huggingface.co/${modelId}/resolve/main/model.onnx`;
        const voiceUrl = `https://huggingface.co/${modelId}/resolve/main/voices/af_heart.bin`;
        const modelCache = fakeCache([[modelUrl, responseWithSize(100)]]);
        const voiceCache = fakeCache([[voiceUrl, responseWithSize(20)]]);
        const service = new TransformersModelCacheService(
            fakeCacheStorage({
                'transformers-cache': modelCache.cache,
                'kokoro-voices': voiceCache.cache
            }),
            directMutation
        );

        await expect(service.deleteModels([`${modelId}@main`])).resolves.toBe(2);
        expect(modelCache.remove).toHaveBeenCalledWith(modelUrl);
        expect(voiceCache.remove).toHaveBeenCalledWith(voiceUrl);
    });

    it('rejects a partial cache deletion', async () => {
        const firstUrl = 'https://huggingface.co/org/model/resolve/main/config.json';
        const secondUrl = 'https://huggingface.co/org/model/resolve/main/model.onnx';
        const modelCache = fakeCache([
            [firstUrl, responseWithSize(10)],
            [secondUrl, responseWithSize(20)]
        ]);
        modelCache.remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const service = new TransformersModelCacheService(
            fakeCacheStorage({ 'transformers-cache': modelCache.cache }),
            directMutation
        );

        await expect(service.deleteModels(['org/model@main'])).rejects.toThrow(
            'Only 1 of 2 model cache files were deleted'
        );
    });

    it('reports unavailable Cache Storage', async () => {
        await expect(
            new TransformersModelCacheService(undefined, directMutation).inspect()
        ).resolves.toEqual({ available: false, models: [], totalBytes: 0, totalSizeKnown: false });
    });

    it('parses encoded revisions and rejects non-model URLs', () => {
        expect(
            parseModelUrl('https://huggingface.co/org/model/resolve/refs%2Fpr%2F1/onnx/model.onnx')
        ).toEqual({ modelId: 'org/model', revision: 'refs/pr/1' });
        expect(
            parseModelUrl('https://huggingface.co/org/model/resolve/main/files/resolve')
        ).toEqual({ modelId: 'org/model', revision: 'main' });
        expect(
            parseModelUrl('https://huggingface.co/bert-base-uncased/resolve/main/config.json')
        ).toEqual({ modelId: 'bert-base-uncased', revision: 'main' });
        expect(parseModelUrl('https://cdn.jsdelivr.net/runtime.wasm')).toBeNull();
    });
});

function responseWithSize(size: number): Response {
    return new Response('', { headers: { 'content-length': String(size) } });
}

function fakeCache(entries: Array<[string, Response]>): {
    cache: Cache;
    remove: ReturnType<typeof vi.fn>;
} {
    const responses = new Map(entries);
    const remove = vi.fn(async (request: RequestInfo | URL) => {
        const url = typeof request === 'string' ? request : request.toString();
        return responses.delete(url);
    });
    return {
        cache: {
            keys: vi.fn(async () => [...responses.keys()].map((url) => new Request(url))),
            match: vi.fn(async (request: RequestInfo | URL) => {
                const url = request instanceof Request ? request.url : request.toString();
                return responses.get(url);
            }),
            delete: remove
        } as unknown as Cache,
        remove
    };
}

function fakeCacheStorage(buckets: Record<string, Cache>): CacheStorage {
    return {
        keys: vi.fn(async () => Object.keys(buckets)),
        open: vi.fn(async (name: string) => buckets[name])
    } as unknown as CacheStorage;
}

async function directMutation<T>(action: () => Promise<T>): Promise<T> {
    return action();
}
