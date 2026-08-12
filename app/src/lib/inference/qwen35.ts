import { fromBase64 } from '$lib/crypto';
import type {
    GenerateOptions,
    InferenceProgressCallback,
    ModelSpec,
    MultimodalGenerateMessage
} from './types';
import {
    createGenerationCancellation,
    getOrLoadTransformersRuntime,
    streamGeneratedText
} from './transformers';

type Qwen35Content = { type: 'text'; text: string } | { type: 'image' };

interface Qwen35Processor {
    (text: string, images?: unknown[]): Promise<Record<string, unknown>>;
    tokenizer: unknown;
    apply_chat_template(
        messages: Array<{ role: string; content: Qwen35Content[] }>,
        options: { add_generation_prompt: boolean }
    ): string;
}

interface Qwen35Model {
    generate(options: Record<string, unknown>): Promise<unknown>;
    dispose?: () => Promise<void> | void;
}

interface Qwen35Runtime {
    processor: Qwen35Processor;
    model: Qwen35Model;
    dispose?: () => Promise<void> | void;
}

async function getOrLoadQwen35(
    spec: ModelSpec,
    device: string,
    onProgress?: InferenceProgressCallback
): Promise<Qwen35Runtime> {
    return getOrLoadTransformersRuntime(
        'qwen35',
        spec,
        device,
        async (progressCallback) => {
            const { AutoProcessor, Qwen3_5ForConditionalGeneration } =
                await import('@huggingface/transformers');
            const [processor, model] = await Promise.all([
                AutoProcessor.from_pretrained(spec.modelId, {
                    revision: spec.revision,
                    progress_callback: progressCallback
                }),
                Qwen3_5ForConditionalGeneration.from_pretrained(spec.modelId, {
                    revision: spec.revision,
                    dtype: {
                        embed_tokens: 'q4',
                        vision_encoder: 'fp16',
                        decoder_model_merged: 'q4'
                    },
                    device: device as 'wasm' | 'webgpu',
                    progress_callback: progressCallback
                })
            ]);
            const qwen35Model = model as unknown as Qwen35Model;
            return {
                processor: processor as unknown as Qwen35Processor,
                model: qwen35Model,
                dispose: () => qwen35Model.dispose?.()
            };
        },
        onProgress
    );
}

async function prepareInputs(
    processor: Qwen35Processor,
    messages: MultimodalGenerateMessage[]
): Promise<{ inputs: Record<string, unknown>; hasImages: boolean }> {
    const { load_image } = await import('@huggingface/transformers');
    const images: unknown[] = [];
    const conversation: Array<{ role: string; content: Qwen35Content[] }> = [];

    for (const message of messages) {
        const content: Qwen35Content[] = [];
        for (const part of message.content) {
            if (part.type === 'text') {
                content.push(part);
            } else if (part.type === 'image') {
                const blob = new Blob([fromBase64(part.data)], { type: part.mimeType });
                images.push(await load_image(blob));
                content.push({ type: 'image' });
            } else {
                throw new Error('Qwen 3.5 does not support audio input');
            }
        }
        conversation.push({ role: message.role, content });
    }

    const prompt = processor.apply_chat_template(conversation, {
        add_generation_prompt: true
    });
    return {
        inputs: await processor(prompt, images.length > 0 ? images : undefined),
        hasImages: images.length > 0
    };
}

class Qwen35Inference {
    async *generate(
        spec: ModelSpec,
        messages: MultimodalGenerateMessage[],
        options?: GenerateOptions
    ): AsyncIterable<string> {
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'webgpu';
        const { processor, model } = await getOrLoadQwen35(spec, device, options?.onProgress);
        options?.signal?.throwIfAborted();
        const { inputs, hasImages } = await prepareInputs(processor, messages);
        options?.signal?.throwIfAborted();

        const cancellation = await createGenerationCancellation(options?.signal);
        try {
            yield* streamGeneratedText(processor.tokenizer, (streamer) =>
                model.generate({
                    ...inputs,
                    streamer,
                    ...(cancellation.stoppingCriteria
                        ? { stopping_criteria: cancellation.stoppingCriteria }
                        : {}),
                    max_new_tokens: options?.max_new_tokens ?? 512,
                    temperature: options?.temperature ?? (hasImages ? 0.7 : 1),
                    top_p: options?.top_p ?? (hasImages ? 0.8 : 1),
                    top_k: options?.top_k ?? 20,
                    repetition_penalty: options?.repetition_penalty ?? 1,
                    do_sample: true
                })
            );
            options?.signal?.throwIfAborted();
        } finally {
            cancellation.dispose();
        }
    }
}

export const qwen35 = new Qwen35Inference();
