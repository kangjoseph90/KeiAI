import { describe, expect, it } from 'vitest';
import { selectEmbeddingHandler } from '$lib/embedding/handler';
import { MockEmbeddingHandler } from '$lib/embedding/handlers/mock';
import { defaultSettings } from '$lib/services/content/settings';

describe('MockEmbeddingHandler', () => {
    it('returns one stable Float32 vector per text in sample mode', async () => {
        const result = await new MockEmbeddingHandler().embed(['alpha', 'beta']);

        expect(result.vectors).toHaveLength(2);
        expect(result.vectors.every((vector) => vector instanceof Float32Array)).toBe(true);
        expect(Array.from(result.vectors[0])).toEqual([1, 0, 0, 0]);
        expect(Array.from(result.vectors[1])).toEqual([1, 0, 0, 0]);
    });

    it('produces deterministic input-sensitive vectors in diagnostic mode', async () => {
        const handler = new MockEmbeddingHandler({ behavior: 'diagnostic' });
        const result = await handler.embed(['shared token', 'shared token', 'different']);

        expect(result.vectors[0]).toEqual(result.vectors[1]);
        expect(result.vectors[0]).not.toEqual(result.vectors[2]);
        expect(result.vectors[0]).toHaveLength(32);
    });

    it('honors cancellation', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            new MockEmbeddingHandler().embed(['text'], controller.signal)
        ).rejects.toThrow();
    });

    it('is selected from mock provider settings with a cache-isolated model ID', () => {
        const settings = structuredClone(defaultSettings);
        settings.mock.embedding.modelId = 'diagnostic';

        const selected = selectEmbeddingHandler('mock', settings);

        expect(selected?.modelId).toBe('mock::diagnostic');
        expect(selected?.handler).toBeInstanceOf(MockEmbeddingHandler);
    });
});
