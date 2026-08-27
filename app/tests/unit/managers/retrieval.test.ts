import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rerank, searchChunks, searchDocuments } from '$lib/managers/retrieval';

const vector = (...components: number[]): Float32Array => new Float32Array(components);
const document = (...chunks: string[]) => ({ chunks });

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    selectEmbeddingHandler: vi.fn(),
    selectRerankerHandler: vi.fn(),
    embedQuery: vi.fn(),
    embedDocuments: vi.fn(),
    rerank: vi.fn(),
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
vi.mock('$lib/crypto', () => ({ sha256: mocks.sha256 }));
vi.mock('$lib/stores', () => ({ getAppSettings: mocks.getAppSettings }));
vi.mock('$lib/embedding', () => ({ selectEmbeddingHandler: mocks.selectEmbeddingHandler }));
vi.mock('$lib/reranker', () => ({ selectRerankerHandler: mocks.selectRerankerHandler }));

describe('retrieval manager', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.sha256.mockImplementation(async (value: string) => value);
        mocks.queryStore.getMany.mockResolvedValue(new Map());
        mocks.documentStore.getMany.mockResolvedValue(new Map());
        mocks.queryStore.setMany.mockResolvedValue(undefined);
        mocks.documentStore.setMany.mockResolvedValue(undefined);
        mocks.queryStore.deleteMany.mockResolvedValue(undefined);
        mocks.documentStore.deleteMany.mockResolvedValue(undefined);
        mocks.getAppSettings.mockResolvedValue({
            embeddingProvider: 'openai',
            rerankerProvider: 'cohere'
        });
        mocks.selectEmbeddingHandler.mockReturnValue({
            modelId: 'openai::embedding-model',
            handler: {
                embedQuery: mocks.embedQuery,
                embedDocuments: mocks.embedDocuments
            }
        });
        mocks.selectRerankerHandler.mockReturnValue({ rerank: mocks.rerank });
        mocks.embedQuery.mockResolvedValue({ vectors: [vector(1, 0)] });
    });

    it('embeds queries separately and preserves document chunk groups', async () => {
        const signal = new AbortController().signal;
        mocks.embedDocuments.mockResolvedValue({
            vectors: [[vector(0, 1), vector(1, 0)], [vector(0.8, 0.2)]]
        });

        await expect(
            searchDocuments(
                'grouped-query',
                [document('first', 'second'), document('third')],
                signal
            )
        ).resolves.toEqual([
            { documentIndex: 0, chunkIndex: 1, score: 1 },
            { documentIndex: 1, chunkIndex: 0, score: expect.closeTo(0.9701) },
            { documentIndex: 0, chunkIndex: 0, score: 0 }
        ]);
        expect(mocks.embedQuery).toHaveBeenCalledWith(['grouped-query'], signal);
        expect(mocks.embedDocuments).toHaveBeenCalledWith([['first', 'second'], ['third']], signal);
    });

    it('reuses a document group cache and invalidates it when context changes', async () => {
        const signal = new AbortController().signal;
        mocks.embedDocuments.mockResolvedValueOnce({
            vectors: [[vector(1, 0), vector(0, 1)]]
        });
        await searchDocuments('cache-identity-query', [document('shared', 'context-a')], signal);
        await searchDocuments('cache-identity-query', [document('shared', 'context-a')], signal);

        mocks.embedDocuments.mockResolvedValueOnce({
            vectors: [[vector(0, 1), vector(1, 0)]]
        });
        await searchDocuments('cache-identity-query', [document('shared', 'context-b')], signal);

        expect(mocks.embedQuery).toHaveBeenCalledTimes(1);
        expect(mocks.embedDocuments).toHaveBeenCalledTimes(2);
    });

    it('deduplicates identical document groups while preserving indices', async () => {
        const signal = new AbortController().signal;
        mocks.embedDocuments.mockResolvedValue({ vectors: [[vector(1, 0)]] });

        await expect(
            searchDocuments('dedupe-query', [document('same'), document('same')], signal)
        ).resolves.toEqual([
            { documentIndex: 0, chunkIndex: 0, score: 1 },
            { documentIndex: 1, chunkIndex: 0, score: 1 }
        ]);
        expect(mocks.embedDocuments).toHaveBeenCalledWith([['same']], signal);
    });

    it('optionally returns only the top K chunks', async () => {
        const signal = new AbortController().signal;
        mocks.embedDocuments.mockResolvedValue({
            vectors: [[vector(0, 1), vector(0.8, 0.2), vector(1, 0)]]
        });

        await expect(
            searchDocuments('top-k-query', [document('low', 'mid', 'high')], signal, 2)
        ).resolves.toEqual([
            { documentIndex: 0, chunkIndex: 2, score: 1 },
            { documentIndex: 0, chunkIndex: 1, score: expect.closeTo(0.9701) }
        ]);
    });

    it('rejects empty document groups and invalid vectors', async () => {
        const signal = new AbortController().signal;
        await expect(searchDocuments('empty-document-query', [document()], signal)).rejects.toThrow(
            'Search documents must contain at least one chunk'
        );

        mocks.embedDocuments.mockResolvedValue({ vectors: [[vector(Number.NaN, 0)]] });
        await expect(searchDocuments('invalid-query', [document('chunk')], signal)).rejects.toThrow(
            'Embedding returned an invalid vector'
        );
    });

    it('searches independent chunks without exposing document grouping', async () => {
        const signal = new AbortController().signal;
        mocks.embedDocuments.mockResolvedValue({
            vectors: [[vector(0, 1)], [vector(1, 0)]]
        });

        await expect(searchChunks('chunk-query', ['first', 'second'], signal)).resolves.toEqual([
            { index: 1, score: 1 },
            { index: 0, score: 0 }
        ]);
        expect(mocks.embedDocuments).toHaveBeenCalledWith([['first'], ['second']], signal);
    });

    it('reuses valid persistent query and document vectors', async () => {
        const signal = new AbortController().signal;
        const queryKey = 'openai::embedding-model\0query\0persistent-query';
        const documentGroupKey = 'openai::embedding-model\0document\0["persistent-chunk"]';
        const documentKey = `${documentGroupKey}\0${0}`;
        mocks.queryStore.getMany.mockResolvedValue(new Map([[queryKey, new Float32Array([1, 0])]]));
        mocks.documentStore.getMany.mockResolvedValue(
            new Map([[documentKey, new Float32Array([1, 0])]])
        );

        await expect(
            searchChunks('persistent-query', ['persistent-chunk'], signal)
        ).resolves.toEqual([{ index: 0, score: 1 }]);
        expect(mocks.embedQuery).not.toHaveBeenCalled();
        expect(mocks.embedDocuments).not.toHaveBeenCalled();
    });

    it('keeps dot-product scores bit-identical to naive accumulation order', async () => {
        const signal = new AbortController().signal;

        // Deterministic PRNG so any failure reproduces exactly.
        let seed = 0x2f6e2b1;
        const random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const naiveDot = (left: Float32Array, right: Float32Array) => {
            let dot = 0;
            for (let index = 0; index < left.length; index += 1) {
                dot += left[index] * right[index];
            }
            return dot;
        };

        const dimension = 1536;
        const chunkCount = 8;
        const chunks = Array.from({ length: chunkCount }, (_, index) => `chunk-${index}`);
        const chunkVectors = Array.from({ length: chunkCount }, () =>
            Array.from({ length: dimension }, () => (random() - 0.5) * 4)
        );
        mocks.embedDocuments.mockResolvedValue({
            vectors: [chunkVectors.map((components) => new Float32Array(components))]
        });
        mocks.embedQuery.mockResolvedValue({
            vectors: [
                new Float32Array(Array.from({ length: dimension }, () => (random() - 0.5) * 4))
            ]
        });

        const results = await searchDocuments('bit-exact-query', [document(...chunks)], signal);
        expect(results).toHaveLength(chunkCount);

        // Reference must use the exact vectors the manager normalized and
        // persisted, not the raw handler outputs.
        await vi.waitFor(() => {
            expect(mocks.documentStore.setMany).toHaveBeenCalled();
            expect(mocks.queryStore.setMany).toHaveBeenCalled();
        });
        const documentEntries = mocks.documentStore.setMany.mock.calls[0][0] as ReadonlyArray<
            readonly [string, Float32Array]
        >;
        const queryEntries = mocks.queryStore.setMany.mock.calls[0][0] as ReadonlyArray<
            readonly [string, Float32Array]
        >;
        expect(documentEntries).toHaveLength(chunkCount);
        const queryVector = queryEntries[0][1];

        for (let index = 0; index < chunkCount; index += 1) {
            const result = results.find((entry) => entry.chunkIndex === index);
            expect(result).toBeDefined();
            const expected = naiveDot(queryVector, documentEntries[index][1]);
            expect(Object.is(result?.score, expected)).toBe(true);
        }

        // A warm repeated search is stable as well.
        await expect(
            searchDocuments('bit-exact-query', [document(...chunks)], signal)
        ).resolves.toEqual(results);
    });

    it('batches by chunk count without splitting document groups', async () => {
        const signal = new AbortController().signal;
        const documents = [
            document(...Array.from({ length: 40 }, (_, index) => `first-${index}`)),
            document(...Array.from({ length: 30 }, (_, index) => `second-${index}`))
        ];
        mocks.embedDocuments.mockImplementation(async (groups: string[][]) => ({
            vectors: groups.map((group) => group.map(() => vector(1, 0)))
        }));

        await searchDocuments('batch-query', documents, signal);

        expect(mocks.embedDocuments).toHaveBeenCalledTimes(2);
        expect(mocks.embedDocuments.mock.calls[0][0]).toEqual([documents[0].chunks]);
        expect(mocks.embedDocuments.mock.calls[1][0]).toEqual([documents[1].chunks]);
    });

    it('does not wait for best-effort persistent cache writes', async () => {
        const signal = new AbortController().signal;
        let finishWrites: (() => void) | undefined;
        const pendingWrite = new Promise<void>((resolve) => {
            finishWrites = resolve;
        });
        mocks.queryStore.setMany.mockReturnValue(pendingWrite);
        mocks.documentStore.setMany.mockReturnValue(pendingWrite);
        mocks.embedDocuments.mockResolvedValue({ vectors: [[vector(1, 0)]] });

        await expect(
            searchChunks('background-query', ['background-chunk'], signal)
        ).resolves.toEqual([{ index: 0, score: 1 }]);
        finishWrites?.();
        await pendingWrite;
    });

    it('rejects a non-positive top K', async () => {
        await expect(
            searchChunks('invalid-top-k-query', ['chunk'], new AbortController().signal, 0)
        ).rejects.toThrow('Search topK must be a positive integer');
    });

    it('returns the selected reranker result unchanged', async () => {
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
