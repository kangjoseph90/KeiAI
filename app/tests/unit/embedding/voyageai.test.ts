import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoyageAIEmbeddingHandler } from '$lib/embedding/handlers/voyageai';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('$lib/adapters/http', () => ({
    appHttp: { fetch: mocks.fetch }
}));

describe('VoyageAIEmbeddingHandler', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('wraps contextualized queries as singleton groups and returns flat vectors', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                data: [
                    { index: 0, data: [{ index: 0, embedding: [1, 2] }] },
                    { index: 1, data: [{ index: 0, embedding: [3, 4] }] }
                ]
            })
        });
        const handler = new VoyageAIEmbeddingHandler({
            baseUrl: 'https://api.voyageai.com/v1',
            modelId: 'voyage-context-4'
        });

        const result = await handler.embedQuery(['first', 'second']);

        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://api.voyageai.com/v1/contextualizedembeddings',
            expect.objectContaining({
                body: JSON.stringify({
                    model: 'voyage-context-4',
                    inputs: [['first'], ['second']],
                    input_type: 'query'
                })
            }),
            expect.objectContaining({ proxy: true })
        );
        expect(result.vectors).toEqual([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    });

    it('flattens standard document groups and restores their grouping', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                data: [
                    { index: 2, embedding: [3, 4] },
                    { index: 0, embedding: [1, 2] },
                    { index: 1, embedding: [2, 3] }
                ]
            })
        });
        const handler = new VoyageAIEmbeddingHandler({
            apiKey: 'secret',
            baseUrl: 'https://api.voyageai.com/v1',
            modelId: 'voyage-4'
        });

        const result = await handler.embedDocuments([['one', 'two'], ['three']]);

        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://api.voyageai.com/v1/embeddings',
            expect.objectContaining({
                body: JSON.stringify({
                    model: 'voyage-4',
                    input: ['one', 'two', 'three'],
                    input_type: 'document'
                })
            }),
            expect.objectContaining({ proxy: true })
        );
        expect(result.vectors).toEqual([
            [new Float32Array([1, 2]), new Float32Array([2, 3])],
            [new Float32Array([3, 4])]
        ]);
    });

    it('uses contextualized endpoint and preserves grouped document vectors', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                data: [
                    {
                        index: 1,
                        data: [{ index: 0, embedding: [3, 4] }]
                    },
                    {
                        index: 0,
                        data: [
                            { index: 1, embedding: [2, 3] },
                            { index: 0, embedding: [1, 2] }
                        ]
                    }
                ]
            })
        });
        const handler = new VoyageAIEmbeddingHandler({
            baseUrl: 'https://api.voyageai.com/v1',
            modelId: 'voyage-context-4'
        });

        const result = await handler.embedDocuments([['one', 'two'], ['three']]);

        expect(mocks.fetch).toHaveBeenCalledWith(
            'https://api.voyageai.com/v1/contextualizedembeddings',
            expect.objectContaining({
                body: JSON.stringify({
                    model: 'voyage-context-4',
                    inputs: [['one', 'two'], ['three']],
                    input_type: 'document'
                })
            }),
            expect.objectContaining({ proxy: true })
        );
        expect(result.vectors).toEqual([
            [new Float32Array([1, 2]), new Float32Array([2, 3])],
            [new Float32Array([3, 4])]
        ]);
    });

    it('rejects duplicate response indices', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                data: [
                    { index: 0, embedding: [1, 2] },
                    { index: 0, embedding: [3, 4] }
                ]
            })
        });
        const handler = new VoyageAIEmbeddingHandler({
            baseUrl: 'https://api.voyageai.com/v1',
            modelId: 'voyage-4'
        });

        await expect(handler.embedQuery(['first', 'second'])).rejects.toThrow(
            'VoyageAI Embedding returned an invalid index'
        );
    });
});
