import { describe, expect, it, vi } from 'vitest';
import { TransformersInference } from '$lib/inference/transformers';

const { mockPipeline } = vi.hoisted(() => ({
    mockPipeline: vi.fn()
}));

vi.mock('@huggingface/transformers', () => ({
    pipeline: mockPipeline
}));

describe('TransformersInference', () => {
    it('returns zero-copy Float32 vector views from embedding output', async () => {
        const data = new Float32Array([1, 2, 3, 4]);
        const extractor = vi.fn(async () => ({ data }));
        mockPipeline.mockResolvedValue(extractor);

        const inference = new TransformersInference();
        const vectors = await inference.embed({ modelId: 'test/float32-embedding-output' }, [
            'first',
            'second'
        ]);

        expect(vectors).toHaveLength(2);
        expect(vectors[0]).toBeInstanceOf(Float32Array);
        expect(vectors[0].buffer).toBe(data.buffer);
        expect([...vectors[0]]).toEqual([1, 2]);
        expect([...vectors[1]]).toEqual([3, 4]);
    });

    it('attaches an ASR pipeline tokenizer to a processor that omitted it', async () => {
        const components: Record<string, unknown> = {};
        const tokenizer = {
            batch_decode: vi.fn((..._args: unknown[]) => ['decoded text'])
        };
        const processor = {
            components,
            get tokenizer(): unknown {
                return components.tokenizer;
            },
            batch_decode(...args: unknown[]): string[] {
                const activeTokenizer = components.tokenizer as typeof tokenizer | undefined;
                if (!activeTokenizer) throw new Error('Unable to decode without a tokenizer.');
                return activeTokenizer.batch_decode(...args);
            }
        };
        const transcriber = Object.assign(
            vi.fn(async () => ({ text: processor.batch_decode([])[0] })),
            {
                tokenizer,
                processor
            }
        );
        mockPipeline.mockResolvedValue(transcriber);

        const inference = new TransformersInference();
        const result = await inference.transcribe(
            { modelId: 'test/asr-with-incomplete-processor' },
            new Float32Array([0])
        );

        expect(result).toEqual({ text: 'decoded text', segments: undefined });
        expect(processor.tokenizer).toBe(tokenizer);
    });
});
