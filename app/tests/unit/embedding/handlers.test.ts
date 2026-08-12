import { describe, expect, it, vi } from 'vitest';
import { OpenAIEmbeddingHandler } from '$lib/embedding/handlers/openai';
import { GoogleEmbeddingHandler } from '$lib/embedding/handlers/google';
import { PluginEmbeddingHandler } from '$lib/embedding/handlers/plugin';
import type { PluginInstance } from '$lib/plugins';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn()
}));

vi.mock('$lib/adapters/http', () => ({
    appHttp: { fetch: mocks.fetch }
}));

describe('embedding handlers', () => {
    it('converts OpenAI JSON embeddings to Float32Array vectors', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                data: [
                    { index: 1, embedding: [3, 4] },
                    { index: 0, embedding: [1, 2] }
                ]
            })
        });
        const handler = new OpenAIEmbeddingHandler({
            baseUrl: 'https://example.com',
            modelId: 'embedding-model'
        });

        const result = await handler.embedQuery(['first', 'second']);

        expect(result.vectors).toEqual([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    });

    it('converts Google JSON embeddings to Float32Array vectors', async () => {
        mocks.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                embeddings: [{ values: [1, 2] }, { values: [3, 4] }]
            })
        });
        const handler = new GoogleEmbeddingHandler({
            baseUrl: 'https://example.com',
            modelId: 'embedding-model'
        });

        const result = await handler.embedQuery(['first', 'second']);

        expect(result.vectors).toEqual([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    });

    it('validates plugin query and document embedding shapes', async () => {
        const invoke = vi
            .fn()
            .mockResolvedValueOnce({ vectors: [new Float32Array([1, 2])] })
            .mockResolvedValueOnce({ vectors: [[1, 2]] })
            .mockResolvedValueOnce({
                vectors: [[new Float32Array([1, 2]), new Float32Array([3, 4])]]
            })
            .mockResolvedValueOnce({ vectors: [[new Float32Array([1, 2])]] });
        const instance = { broker: { invoke } } as unknown as PluginInstance;
        const handler = new PluginEmbeddingHandler(instance, 'embedding-function');

        await expect(handler.embedQuery(['valid'])).resolves.toEqual({
            vectors: [new Float32Array([1, 2])]
        });
        await expect(handler.embedQuery(['invalid'])).rejects.toThrow(
            'Plugin embedding provider returned an invalid result'
        );
        await expect(handler.embedDocuments([['first', 'second']])).resolves.toEqual({
            vectors: [[new Float32Array([1, 2]), new Float32Array([3, 4])]]
        });
        await expect(handler.embedDocuments([['first', 'second']])).rejects.toThrow(
            'Plugin embedding provider returned an invalid result'
        );
        expect(invoke).toHaveBeenNthCalledWith(
            1,
            'embedding-function',
            ['query', ['valid']],
            undefined
        );
        expect(invoke).toHaveBeenNthCalledWith(
            3,
            'embedding-function',
            ['document', [['first', 'second']]],
            undefined
        );
    });
});
