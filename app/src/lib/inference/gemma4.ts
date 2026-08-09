import { fromBase64 } from '$lib/crypto';
import type {
    GenerateOptions,
    InferenceProgressCallback,
    ModelSpec,
    MultimodalGenerateMessage
} from './types';
import { getOrLoadTransformersRuntime, streamGeneratedText } from './transformers';

type Gemma4Content = { type: 'text'; text: string } | { type: 'image' } | { type: 'audio' };

interface Gemma4Processor {
    (
        text: string,
        images?: unknown[],
        audio?: Float32Array[],
        options?: { add_special_tokens?: boolean }
    ): Promise<Record<string, unknown>>;
    tokenizer: unknown;
    apply_chat_template(
        messages: Array<{ role: string; content: Gemma4Content[] }>,
        options: { add_generation_prompt: boolean; enable_thinking: boolean }
    ): string;
}

interface Gemma4Model {
    generate(options: Record<string, unknown>): Promise<unknown>;
    dispose?: () => Promise<void> | void;
}

interface Gemma4Runtime {
    processor: Gemma4Processor;
    model: Gemma4Model;
    dispose?: () => Promise<void> | void;
}

async function getOrLoadGemma4(
    spec: ModelSpec,
    device: string,
    onProgress?: InferenceProgressCallback
): Promise<Gemma4Runtime> {
    return getOrLoadTransformersRuntime(
        'gemma4',
        spec,
        device,
        async (progressCallback) => {
            const { AutoProcessor, Gemma4ForConditionalGeneration } =
                await import('@huggingface/transformers');
            const [processor, model] = await Promise.all([
                AutoProcessor.from_pretrained(spec.modelId, {
                    revision: spec.revision,
                    progress_callback: progressCallback
                }),
                Gemma4ForConditionalGeneration.from_pretrained(spec.modelId, {
                    revision: spec.revision,
                    dtype: spec.quantization ?? 'q4f16',
                    device: device as 'wasm' | 'webgpu',
                    progress_callback: progressCallback
                })
            ]);
            const gemma4Model = model as unknown as Gemma4Model;
            return {
                processor: processor as unknown as Gemma4Processor,
                model: gemma4Model,
                dispose: () => gemma4Model.dispose?.()
            };
        },
        onProgress
    );
}

async function prepareInputs(
    processor: Gemma4Processor,
    messages: MultimodalGenerateMessage[]
): Promise<Record<string, unknown>> {
    const { load_image } = await import('@huggingface/transformers');
    const { decodeAudio } = await import('$lib/utils/audio');
    const images: unknown[] = [];
    const audio: Float32Array[] = [];
    const conversation: Array<{ role: string; content: Gemma4Content[] }> = [];

    for (const message of messages) {
        const content: Gemma4Content[] = [];
        for (const part of message.content) {
            if (part.type === 'text') {
                content.push(part);
            } else if (part.type === 'image') {
                const blob = new Blob([fromBase64(part.data)], { type: part.mimeType });
                images.push(await load_image(blob));
                content.push({ type: 'image' });
            } else {
                const blob = new Blob([fromBase64(part.data)], { type: part.mimeType });
                audio.push(await decodeAudio(await blob.arrayBuffer()));
                content.push({ type: 'audio' });
            }
        }
        conversation.push({ role: message.role, content });
    }

    const prompt = processor.apply_chat_template(conversation, {
        add_generation_prompt: true,
        enable_thinking: false
    });
    return processor(
        prompt,
        images.length > 0 ? images : undefined,
        audio.length > 0 ? audio : undefined,
        { add_special_tokens: false }
    );
}

class Gemma4Inference {
    async *generate(
        spec: ModelSpec,
        messages: MultimodalGenerateMessage[],
        options?: GenerateOptions
    ): AsyncIterable<string> {
        const device = options?.device ?? 'webgpu';
        const { processor, model } = await getOrLoadGemma4(spec, device, options?.onProgress);
        const inputs = await prepareInputs(processor, messages);

        yield* streamGeneratedText(processor.tokenizer, (streamer) =>
            model.generate({
                ...inputs,
                streamer,
                max_new_tokens: options?.max_new_tokens ?? 512,
                temperature: options?.temperature ?? 1,
                top_p: options?.top_p ?? 0.95,
                top_k: options?.top_k ?? 64,
                repetition_penalty: options?.repetition_penalty ?? 1.1,
                do_sample: true
            })
        );
    }
}

export const gemma4 = new Gemma4Inference();
