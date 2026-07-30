import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rerank, similarity } from '$lib/managers/retrieval';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    selectEmbeddingHandler: vi.fn(),
    selectRerankerHandler: vi.fn(),
    embed: vi.fn(),
    rerank: vi.fn(),
    cache: new Map<string, number[]>(),
    getMany: vi.fn(),
    setMany: vi.fn(),
    deleteMany: vi.fn()
}));

vi.mock('$lib/adapters/cache', () => ({
    createAsyncCache: () => ({
        getMany: mocks.getMany,
        setMany: mocks.setMany,
        deleteMany: mocks.deleteMany
    })
}));

vi.mock('$lib/crypto', () => ({
    sha256: vi.fn(async (value: string) => value)
}));

vi.mock('$lib/stores', () => ({
    getAppSettings: mocks.getAppSettings
}));

vi.mock('$lib/embedding', () => ({
    selectEmbeddingHandler: mocks.selectEmbeddingHandler
}));

vi.mock('$lib/reranker', () => ({
    selectRerankerHandler: mocks.selectRerankerHandler
}));

describe('retrieval manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cache.clear();
        mocks.getMany.mockImplementation(async (keys: string[]) => {
            return new Map(
                keys
                    .filter((key) => mocks.cache.has(key))
                    .map((key) => [key, mocks.cache.get(key)!])
            );
        });
        mocks.setMany.mockImplementation(async (entries: Array<readonly [string, number[]]>) => {
            for (const [key, value] of entries) mocks.cache.set(key, value);
        });
        mocks.deleteMany.mockImplementation(async (keys: string[]) => {
            for (const key of keys) mocks.cache.delete(key);
        });
        mocks.getAppSettings.mockResolvedValue({
            embeddingProvider: 'openai',
            rerankerProvider: 'cohere'
        });
        mocks.selectEmbeddingHandler.mockReturnValue({
            modelId: 'openai::embedding-model',
            handler: { embed: mocks.embed }
        });
        mocks.selectRerankerHandler.mockReturnValue({ rerank: mocks.rerank });
    });

    it('ranks documents by embedding cosine similarity', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [
                [1, 0],
                [0, 1],
                [1, 0]
            ]
        });

        await expect(similarity('query', ['first', 'second'], signal)).resolves.toEqual([
            { index: 1, score: 1 },
            { index: 0, score: 0 }
        ]);
        expect(mocks.embed).toHaveBeenCalledWith(['query', 'first', 'second'], signal);
    });

    it('embeds only cache misses and reuses vectors for the selected model', async () => {
        const signal = new AbortController().signal;
        mocks.cache.set('openai::embedding-model\0first', [0, 1]);
        mocks.embed.mockResolvedValue({
            vectors: [
                [1, 0],
                [1, 0]
            ]
        });

        await expect(similarity('query', ['first', 'second'], signal)).resolves.toEqual([
            { index: 1, score: 1 },
            { index: 0, score: 0 }
        ]);
        expect(mocks.embed).toHaveBeenCalledWith(['query', 'second'], signal);
        expect(mocks.cache.get('openai::embedding-model\0query')).toEqual([1, 0]);
        expect(mocks.cache.get('openai::embedding-model\0second')).toEqual([1, 0]);
    });

    it('deduplicates identical cache misses', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({ vectors: [[1, 0]] });

        await similarity('same', ['same', 'same'], signal);

        expect(mocks.embed).toHaveBeenCalledWith(['same'], signal);
    });

    it('rejects invalid embedding vectors before caching them', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [
                [1, 0],
                [Number.NaN, 0]
            ]
        });

        await expect(similarity('query', ['document'], signal)).rejects.toThrow(
            'Embedding returned an invalid vector'
        );
        expect(mocks.setMany).not.toHaveBeenCalled();
    });

    it('returns the selected reranker result', async () => {
        const signal = new AbortController().signal;
        const result = [
            { index: 1, score: 0.9 },
            { index: 0, score: 0.4 }
        ];
        mocks.rerank.mockResolvedValue(result);

        await expect(rerank('query', ['first', 'second'], signal)).resolves.toBe(result);
        expect(mocks.rerank).toHaveBeenCalledWith('query', ['first', 'second'], signal);
    });
});
