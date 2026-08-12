import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rerank, similarity } from '$lib/managers/retrieval';

const vector = (...components: number[]): Float32Array => new Float32Array(components);

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    selectEmbeddingHandler: vi.fn(),
    selectRerankerHandler: vi.fn(),
    embed: vi.fn(),
    rerank: vi.fn(),
    queryCache: new Map<string, number[]>(),
    documentCache: new Map<string, number[]>(),
    queryStore: {
        getMany: vi.fn(),
        setMany: vi.fn(),
        deleteMany: vi.fn()
    },
    documentStore: {
        getMany: vi.fn(),
        setMany: vi.fn(),
        deleteMany: vi.fn()
    },
    sha256: vi.fn(async (value: string) => value)
}));

vi.mock('$lib/adapters/cache', () => ({
    createAsyncCache: (namespace: string) =>
        namespace === 'normalized-embedding-query-vectors' ? mocks.queryStore : mocks.documentStore
}));

vi.mock('$lib/crypto', () => ({
    sha256: mocks.sha256
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
        mocks.queryCache.clear();
        mocks.documentCache.clear();
        mocks.queryStore.getMany.mockImplementation(async (keys: string[]) => {
            return new Map(
                keys
                    .filter((key) => mocks.queryCache.has(key))
                    .map((key) => [key, mocks.queryCache.get(key)!])
            );
        });
        mocks.documentStore.getMany.mockImplementation(async (keys: string[]) => {
            return new Map(
                keys
                    .filter((key) => mocks.documentCache.has(key))
                    .map((key) => [key, mocks.documentCache.get(key)!])
            );
        });
        mocks.queryStore.setMany.mockImplementation(
            async (entries: Array<readonly [string, number[]]>) => {
                for (const [key, value] of entries) mocks.queryCache.set(key, value);
            }
        );
        mocks.documentStore.setMany.mockImplementation(
            async (entries: Array<readonly [string, number[]]>) => {
                for (const [key, value] of entries) mocks.documentCache.set(key, value);
            }
        );
        mocks.queryStore.deleteMany.mockImplementation(async (keys: string[]) => {
            for (const key of keys) mocks.queryCache.delete(key);
        });
        mocks.documentStore.deleteMany.mockImplementation(async (keys: string[]) => {
            for (const key of keys) mocks.documentCache.delete(key);
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

    it('ranks documents by normalized dot-product similarity', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(0, 1), vector(1, 0)]
        });

        await expect(
            similarity('rank-query', ['rank-first', 'rank-second'], signal)
        ).resolves.toEqual([
            { index: 1, score: 1 },
            { index: 0, score: 0 }
        ]);
        expect(mocks.embed).toHaveBeenCalledWith(
            ['rank-query', 'rank-first', 'rank-second'],
            signal
        );
    });

    it('embeds only cache misses and reuses vectors for the selected model', async () => {
        const signal = new AbortController().signal;
        mocks.documentCache.set('openai::embedding-model\0first', [0, 1]);
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(1, 0)]
        });

        await expect(similarity('query', ['first', 'second'], signal)).resolves.toEqual([
            { index: 1, score: 1 },
            { index: 0, score: 0 }
        ]);
        expect(mocks.embed).toHaveBeenCalledWith(['query', 'second'], signal);
        expect(mocks.queryCache.get('openai::embedding-model\0query')).toEqual([1, 0]);
        expect(mocks.documentCache.get('openai::embedding-model\0second')).toEqual([1, 0]);
    });

    it('deduplicates identical cache misses', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({ vectors: [vector(1, 0)] });

        await similarity('same', ['same', 'same'], signal);

        expect(mocks.embed).toHaveBeenCalledWith(['same'], signal);
        expect(mocks.queryCache.get('openai::embedding-model\0same')).toEqual([1, 0]);
        expect(mocks.documentCache.get('openai::embedding-model\0same')).toEqual([1, 0]);
    });

    it('hashes duplicate documents once while preserving their result indices', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(1, 0), vector(0, 1)]
        });

        await expect(
            similarity('dedupe-query', ['duplicate', 'other', 'duplicate'], signal)
        ).resolves.toEqual([
            { index: 0, score: 1 },
            { index: 2, score: 1 },
            { index: 1, score: 0 }
        ]);
        expect(mocks.embed).toHaveBeenCalledWith(['dedupe-query', 'duplicate', 'other'], signal);
        expect(mocks.embed).toHaveBeenCalledTimes(1);
        expect(mocks.sha256).toHaveBeenCalledTimes(3);
    });

    it('promotes independent query and document L2 hits into their L1 caches', async () => {
        const signal = new AbortController().signal;
        mocks.queryCache.set('openai::embedding-model\0cached-query', [1, 0]);
        mocks.documentCache.set('openai::embedding-model\0cached-document', [1, 0]);

        await expect(similarity('cached-query', ['cached-document'], signal)).resolves.toEqual([
            { index: 0, score: 1 }
        ]);

        mocks.queryStore.getMany.mockClear();
        mocks.documentStore.getMany.mockClear();
        mocks.queryCache.clear();
        mocks.documentCache.clear();

        await expect(similarity('cached-query', ['cached-document'], signal)).resolves.toEqual([
            { index: 0, score: 1 }
        ]);
        expect(mocks.queryStore.getMany).not.toHaveBeenCalled();
        expect(mocks.documentStore.getMany).not.toHaveBeenCalled();
        expect(mocks.embed).not.toHaveBeenCalled();
    });

    it('normalizes embeddings before storing and scores them with dot product', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [vector(3, 0), vector(3, 4)]
        });

        await expect(similarity('normal-query', ['normal-document'], signal)).resolves.toEqual([
            { index: 0, score: expect.closeTo(0.6) }
        ]);
        expect(mocks.queryCache.get('openai::embedding-model\0normal-query')).toEqual([1, 0]);
        expect(mocks.documentCache.get('openai::embedding-model\0normal-document')).toEqual([
            expect.closeTo(0.6),
            expect.closeTo(0.8)
        ]);
    });

    it('does not wait for best-effort L2 writes before returning', async () => {
        const signal = new AbortController().signal;
        let resolveWrites: (() => void) | undefined;
        const pendingWrite = new Promise<void>((resolve) => {
            resolveWrites = resolve;
        });
        mocks.queryStore.setMany.mockReturnValue(pendingWrite);
        mocks.documentStore.setMany.mockReturnValue(pendingWrite);
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(1, 0)]
        });

        await expect(
            similarity('background-query', ['background-document'], signal)
        ).resolves.toEqual([{ index: 0, score: 1 }]);
        expect(mocks.queryStore.setMany).toHaveBeenCalled();
        expect(mocks.documentStore.setMany).toHaveBeenCalled();
        resolveWrites?.();
        await pendingWrite;
    });

    it('embeds cache misses in bounded sequential batches', async () => {
        const signal = new AbortController().signal;
        const documents = Array.from({ length: 64 }, (_, index) => `batch-document-${index}`);
        mocks.embed
            .mockResolvedValueOnce({
                vectors: Array.from({ length: 64 }, () => vector(1, 0))
            })
            .mockResolvedValueOnce({ vectors: [vector(1, 0)] });

        await similarity('batch-query', documents, signal);

        expect(mocks.embed).toHaveBeenCalledTimes(2);
        expect(mocks.embed.mock.calls[0][0]).toHaveLength(64);
        expect(mocks.embed.mock.calls[1][0]).toHaveLength(1);
        expect(mocks.embed.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.embed.mock.invocationCallOrder[1]
        );
    });

    it('optionally returns only the top K results', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(0, 1), vector(0.8, 0.2), vector(1, 0)]
        });

        await expect(
            similarity('top-query', ['top-low', 'top-mid', 'top-high'], signal, 2)
        ).resolves.toEqual([
            { index: 2, score: 1 },
            { index: 1, score: expect.closeTo(0.9701) }
        ]);

        await expect(
            similarity('top-query', ['top-low', 'top-mid', 'top-high'], signal)
        ).resolves.toHaveLength(3);
    });

    it('rejects a non-positive top K', async () => {
        await expect(
            similarity('top-query-invalid', ['document'], new AbortController().signal, 0)
        ).rejects.toThrow('Similarity topK must be a positive integer');
    });

    it('rejects invalid embedding vectors before caching them', async () => {
        const signal = new AbortController().signal;
        mocks.embed.mockResolvedValue({
            vectors: [vector(1, 0), vector(Number.NaN, 0)]
        });

        await expect(similarity('invalid-query', ['invalid-document'], signal)).rejects.toThrow(
            'Embedding returned an invalid vector'
        );
        expect(mocks.queryStore.setMany).not.toHaveBeenCalled();
        expect(mocks.documentStore.setMany).not.toHaveBeenCalled();
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
