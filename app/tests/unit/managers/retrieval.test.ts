import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rerank, similarity } from '$lib/managers/retrieval';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    selectEmbeddingHandler: vi.fn(),
    selectRerankerHandler: vi.fn(),
    embed: vi.fn(),
    rerank: vi.fn()
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
