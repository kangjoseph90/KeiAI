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

        const result = await handler.embed(['first', 'second']);

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

        const result = await handler.embed(['first', 'second']);

        expect(result.vectors).toEqual([new Float32Array([1, 2]), new Float32Array([3, 4])]);
    });

    it('requires plugin providers to return Float32Array vectors', async () => {
        const invoke = vi
            .fn()
            .mockResolvedValueOnce({ vectors: [new Float32Array([1, 2])] })
            .mockResolvedValueOnce({ vectors: [[1, 2]] });
        const instance = { broker: { invoke } } as unknown as PluginInstance;
        const handler = new PluginEmbeddingHandler(instance, 'embedding-function');

        await expect(handler.embed(['valid'])).resolves.toEqual({
            vectors: [new Float32Array([1, 2])]
        });
        await expect(handler.embed(['invalid'])).rejects.toThrow(
            'Plugin embedding provider returned an invalid result'
        );
    });
});
