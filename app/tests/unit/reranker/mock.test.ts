import { describe, expect, it } from 'vitest';
import { selectRerankerHandler } from '$lib/reranker/handler';
import { MockRerankerHandler } from '$lib/reranker/handlers/mock';
import { defaultSettings } from '$lib/services/content/settings';

describe('MockRerankerHandler', () => {
    it('returns documents in stable input order in sample mode', async () => {
        const result = await new MockRerankerHandler().rerank(
            'query',
            ['first', 'second', 'third'],
            new AbortController().signal
        );

        expect(result.map(({ index }) => index)).toEqual([0, 1, 2]);
        expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('ranks documents by query-token overlap in diagnostic mode', async () => {
        const result = await new MockRerankerHandler({ behavior: 'diagnostic' }).rerank(
            'red fox',
            ['blue whale', 'red flower', 'red fox jumps'],
            new AbortController().signal
        );

        expect(result).toEqual([
            { index: 2, score: 1 },
            { index: 1, score: 0.5 },
            { index: 0, score: 0 }
        ]);
    });

    it('honors cancellation', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            new MockRerankerHandler().rerank('q', ['d'], controller.signal)
        ).rejects.toThrow();
    });

    it('is selected from mock provider settings', () => {
        const settings = structuredClone(defaultSettings);
        settings.mock.reranker.modelId = 'diagnostic';

        expect(selectRerankerHandler('mock', settings)).toBeInstanceOf(MockRerankerHandler);
    });
});
