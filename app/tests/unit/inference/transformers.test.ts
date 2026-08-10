import { describe, expect, it, vi } from 'vitest';
import { TransformersInference } from '$lib/inference/transformers';

const { mockPipeline } = vi.hoisted(() => ({
    mockPipeline: vi.fn()
}));

vi.mock('@huggingface/transformers', () => ({
    pipeline: mockPipeline
}));

describe('TransformersInference', () => {
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
