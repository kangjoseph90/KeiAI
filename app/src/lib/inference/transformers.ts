/**
 * Transformers Inference Runtime — KeiAI
 *
 * Local model execution via @huggingface/transformers (ONNX WASM / WebGPU).
 * Pipelines are lazy-loaded and cached by modelId to avoid repeated init cost.
 *
 * Runs on the main thread. Worker isolation is a future optimization
 * (requires SharedArrayBuffer + COOP/COEP headers for Transferable).
 */

import type {
    ModelSpec,
    EmbedOptions,
    SynthesizeOptions,
    GenerateOptions,
    TranscribeOptions,
    TranscribeResult,
    SynthesizeResult,
    RerankOptions,
    InferenceProgressCallback
} from './types';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('inference:transformers');

// ─── Pipeline Cache ───────────────────────────────────────────────────────────

type CachedPipeline = ((...args: unknown[]) => Promise<unknown>) & {
    tokenizer?: unknown;
    dispose?: () => Promise<void> | void;
};

const pipelineCache = new Map<string, CachedPipeline>();

function cacheKey(task: string, modelId: string, device: string): string {
    return `${task}::${modelId}::${device}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toProgressCallback(
    onProgress?: InferenceProgressCallback
): ((event: { status: string; progress?: number; file?: string }) => void) | undefined {
    if (!onProgress) return undefined;
    return (event) => {
        if (event.status === 'downloading') {
            onProgress({ status: 'download', progress: event.progress });
        } else if (event.status === 'loading') {
            onProgress({ status: 'load' });
        } else if (event.status === 'ready') {
            onProgress({ status: 'ready' });
        }
    };
}

async function getOrLoadPipeline(
    task: string,
    spec: ModelSpec,
    device: string,
    onProgress?: InferenceProgressCallback
): Promise<CachedPipeline> {
    const key = cacheKey(task, spec.modelId, device);
    const cached = pipelineCache.get(key);
    if (cached) return cached;

    logger.info(`Loading pipeline: ${key}`);
    const { pipeline } = await import('@huggingface/transformers');

    const p = await pipeline(task as Parameters<typeof pipeline>[0], spec.modelId, {
        revision: spec.revision,
        dtype: (spec.quantization ?? 'q8') as
            | 'q8'
            | 'fp32'
            | 'fp16'
            | 'int8'
            | 'uint8'
            | 'q4'
            | 'auto',
        device: device as 'wasm' | 'webgpu',
        progress_callback: toProgressCallback(onProgress)
    });

    const cachedPipeline = p as unknown as CachedPipeline;
    pipelineCache.set(key, cachedPipeline);
    onProgress?.({ status: 'ready' });
    logger.info(`Pipeline ready: ${key}`);
    return cachedPipeline;
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export class TransformersInference {
    async embed(spec: ModelSpec, texts: string[], options?: EmbedOptions): Promise<number[][]> {
        const device = options?.device ?? 'wasm';
        const extractor = await getOrLoadPipeline(
            'feature-extraction',
            spec,
            device,
            options?.onProgress
        );

        const result = (await extractor(texts, {
            pooling: 'mean',
            normalize: true
        })) as { data: Float32Array };

        // result.data is a flat Float32Array; split into per-text vectors
        const data = result.data;
        const dims = data.length / texts.length;
        const vectors: number[][] = [];
        for (let i = 0; i < texts.length; i++) {
            vectors.push(Array.from(data.subarray(i * dims, (i + 1) * dims)));
        }
        return vectors;
    }

    async synthesize(
        spec: ModelSpec,
        text: string,
        options?: SynthesizeOptions
    ): Promise<SynthesizeResult> {
        const device = options?.device ?? 'wasm';
        const synthesizer = await getOrLoadPipeline(
            'text-to-speech',
            spec,
            device,
            options?.onProgress
        );

        const out = (await synthesizer(text, {})) as {
            audio: Float32Array;
            sampling_rate?: number;
        };

        // `out.audio` is a Float32Array of PCM samples returned as a single result.
        // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer incompatibility.
        const audio = out.audio;
        const copy = new ArrayBuffer(audio.byteLength);
        new Uint8Array(copy).set(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength));
        return {
            audio: copy,
            sampleRate: Number(out.sampling_rate) || 22050
        };
    }

    async *generate(
        spec: ModelSpec,
        messages: { role: string; content: string }[],
        options?: GenerateOptions
    ): AsyncIterable<string> {
        const device = options?.device ?? 'webgpu';
        const generator = await getOrLoadPipeline(
            'text-generation',
            spec,
            device,
            options?.onProgress
        );

        let resolvedMessages = messages;
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            resolvedMessages = messages.slice(0, -1);
        }

        // TextStreamer handles extracting just the newly generated tokens
        const { TextStreamer } = await import('@huggingface/transformers');
        const streamer = new TextStreamer(
            generator.tokenizer as ConstructorParameters<typeof TextStreamer>[0],
            { skip_prompt: true }
        );

        // We need a queue to bridge the callback-based streamer into an AsyncIterable
        const queue: (string | null)[] = [];
        let resolveNext: (() => void) | null = null;

        const originalOnFinalizedText = streamer.on_finalized_text.bind(streamer);
        streamer.on_finalized_text = (text: string, streamEnd?: boolean) => {
            originalOnFinalizedText(text, streamEnd ?? false);
            queue.push(text);
            if (streamEnd) {
                queue.push(null); // EOF indicator
            }
            resolveNext?.();
        };

        // Start generation asynchronously
        generator(resolvedMessages, {
            streamer,
            max_new_tokens: options?.max_new_tokens ?? 512,
            temperature: options?.temperature ?? 0.7,
            top_p: options?.top_p ?? 0.9,
            top_k: options?.top_k ?? 50,
            repetition_penalty: options?.repetition_penalty ?? 1.1,
            do_sample: true
        }).catch((err: unknown) => {
            logger.error('Generation failed:', err);
            queue.push(null);
            resolveNext?.();
        });

        // Yield from queue
        while (true) {
            if (queue.length === 0) {
                await new Promise<void>((r) => (resolveNext = r));
            }
            const token = queue.shift();
            if (token === null) break;
            if (token !== undefined) yield token;
        }
    }

    async transcribe(
        spec: ModelSpec,
        audio: Blob | Float32Array,
        options?: TranscribeOptions
    ): Promise<TranscribeResult> {
        const device = options?.device ?? 'wasm';
        const transcriber = await getOrLoadPipeline(
            'automatic-speech-recognition',
            spec,
            device,
            options?.onProgress
        );

        // Convert Blob to Float32Array if needed
        let audioData: Blob | Float32Array = audio;
        if (audio instanceof Blob) {
            const arrayBuffer = await audio.arrayBuffer();
            const { decodeAudio } = await import('$lib/utils/audio');
            audioData = await decodeAudio(arrayBuffer);
        }

        const result = (await transcriber(audioData, {
            return_timestamps: true,
            ...(options?.language ? { language: options.language } : {})
        })) as {
            text?: string;
            chunks?: Array<{
                text: string;
                timestamp: [number | null, number | null];
            }>;
        };

        const segments = result.chunks?.map((chunk) => ({
            text: chunk.text,
            start: chunk.timestamp?.[0] ?? 0,
            end: chunk.timestamp?.[1] ?? 0
        }));

        return {
            text: result.text ?? '',
            segments: segments?.length ? segments : undefined
        };
    }

    async rerank(
        spec: ModelSpec,
        query: string,
        documents: string[],
        options?: RerankOptions
    ): Promise<number[]> {
        const device = options?.device ?? 'wasm';
        const classifier = await getOrLoadPipeline(
            'text-classification',
            spec,
            device,
            options?.onProgress
        );

        const scores: number[] = [];
        // Transformers.js 'text-classification' pipeline supports (text, text_pair) arguments
        for (const doc of documents) {
            const out = (await classifier(query, doc)) as
                | { score: number }
                | Array<{ score: number }>;
            // Depending on the model, it might return an array of objects like [{ label: 'LABEL_0', score: 0.99 }]
            // Rerankers typically just have one output score.
            scores.push(out instanceof Array ? out[0].score : out.score);
        }

        return scores;
    }

    async dispose(modelId: string): Promise<void> {
        for (const [key, pipeline] of pipelineCache) {
            if (key.includes(`::${modelId}::`)) {
                await pipeline.dispose?.();
                pipelineCache.delete(key);
                logger.info(`Disposed pipeline: ${key}`);
            }
        }
    }

    async disposeAll(): Promise<void> {
        for (const [key, pipeline] of pipelineCache) {
            await pipeline.dispose?.();
            logger.info(`Disposed pipeline: ${key}`);
        }
        pipelineCache.clear();
    }
}

export const transformers = new TransformersInference();
