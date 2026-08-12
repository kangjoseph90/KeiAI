/**
 * Transformers Inference Runtime — KeiAI
 *
 * Local model execution via @huggingface/transformers (ONNX WASM / WebGPU).
 * Pipelines are lazy-loaded and cached by modelId to avoid repeated init cost.
 *
 * Runtime core hosted by the Transformers inference worker.
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
import { WebLoggerAdapter } from '$lib/adapters/logger/web';

const logger = new WebLoggerAdapter().createLogger('inference:transformers');

// ─── Pipeline Cache ───────────────────────────────────────────────────────────

export interface DisposableTransformersRuntime {
    dispose?: () => Promise<void> | void;
}

interface PipelineProcessor {
    readonly tokenizer?: unknown;
    components?: Record<string, unknown>;
}

type CachedPipeline = ((...args: unknown[]) => Promise<unknown>) &
    DisposableTransformersRuntime & {
        tokenizer?: unknown;
        processor?: PipelineProcessor;
    };

interface SequenceClassificationPipeline extends CachedPipeline {
    tokenizer: (
        texts: string[],
        options: { text_pair: string[]; padding: boolean; truncation: boolean }
    ) => unknown;
    model: (inputs: unknown) => Promise<{ logits: { data: ArrayLike<number> } }>;
}

const runtimeCache = new Map<string, DisposableTransformersRuntime>();

function cacheKey(task: string, modelId: string, device: string): string {
    return `${task}::${modelId}::${device}`;
}

function attachMissingProcessorTokenizer(task: string, pipeline: CachedPipeline): void {
    const processor = pipeline.processor;
    if (
        task !== 'automatic-speech-recognition' ||
        processor === undefined ||
        processor.tokenizer !== undefined ||
        pipeline.tokenizer === undefined ||
        processor.components === undefined
    ) {
        return;
    }

    // Some converted ASR repositories load the tokenizer separately without including
    // it in the processor that owns output decoding.
    processor.components.tokenizer = pipeline.tokenizer;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type TransformersProgressCallback = (event: {
    status: string;
    progress?: number;
    file?: string;
}) => void;

function toProgressCallback(
    onProgress?: InferenceProgressCallback
): TransformersProgressCallback | undefined {
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

export async function getOrLoadTransformersRuntime<T extends DisposableTransformersRuntime>(
    kind: string,
    spec: ModelSpec,
    device: string,
    load: (progressCallback?: TransformersProgressCallback) => Promise<T>,
    onProgress?: InferenceProgressCallback
): Promise<T> {
    const key = cacheKey(kind, spec.modelId, device);
    const cached = runtimeCache.get(key);
    if (cached) return cached as T;

    logger.info(`Loading runtime: ${key}`);
    const runtime = await load(toProgressCallback(onProgress));
    runtimeCache.set(key, runtime);
    onProgress?.({ status: 'ready' });
    logger.info(`Runtime ready: ${key}`);
    return runtime;
}

async function getOrLoadPipeline(
    task: string,
    spec: ModelSpec,
    device: string,
    onProgress?: InferenceProgressCallback
): Promise<CachedPipeline> {
    // Quantized Whisper/Moonshine decoder graphs can fail during ONNX Runtime's
    // QDQ optimization before inference starts. Prefer the unquantized ASR graph;
    // callers can still opt into another dtype explicitly through ModelSpec.
    const dtype = spec.quantization ?? (task === 'automatic-speech-recognition' ? 'fp32' : 'q8');

    return getOrLoadTransformersRuntime(
        task,
        spec,
        device,
        async (progressCallback) => {
            const { pipeline } = await import('@huggingface/transformers');
            const loaded = await pipeline(task as Parameters<typeof pipeline>[0], spec.modelId, {
                revision: spec.revision,
                dtype,
                device: device as 'wasm' | 'webgpu',
                progress_callback: progressCallback
            });
            const cachedPipeline = loaded as unknown as CachedPipeline;
            attachMissingProcessorTokenizer(task, cachedPipeline);
            return cachedPipeline;
        },
        onProgress
    );
}

export async function* streamGeneratedText(
    tokenizer: unknown,
    startGeneration: (streamer: unknown) => Promise<unknown>
): AsyncIterable<string> {
    const { TextStreamer } = await import('@huggingface/transformers');
    const streamer = new TextStreamer(tokenizer as ConstructorParameters<typeof TextStreamer>[0], {
        skip_prompt: true,
        callback_function: () => undefined
    });
    const queue: Array<string | null | Error> = [];
    let resolveNext: (() => void) | null = null;
    let ended = false;
    const wake = (): void => {
        resolveNext?.();
        resolveNext = null;
    };

    const originalOnFinalizedText = streamer.on_finalized_text.bind(streamer);
    streamer.on_finalized_text = (text: string, streamEnd: boolean) => {
        originalOnFinalizedText(text, streamEnd);
        if (text) queue.push(text);
        if (streamEnd) {
            ended = true;
            queue.push(null);
        }
        wake();
    };

    void startGeneration(streamer)
        .then(() => {
            if (!ended) queue.push(null);
            wake();
        })
        .catch((error: unknown) => {
            queue.push(error instanceof Error ? error : new Error(String(error)));
            wake();
        });

    while (true) {
        if (queue.length === 0) {
            await new Promise<void>((resolve) => (resolveNext = resolve));
        }
        const item = queue.shift();
        if (item === null) break;
        if (item instanceof Error) throw item;
        if (item !== undefined) yield item;
    }
}

export interface GenerationCancellation {
    stoppingCriteria?: unknown;
    dispose: () => void;
}

export async function createGenerationCancellation(
    signal?: AbortSignal
): Promise<GenerationCancellation> {
    if (!signal) return { dispose: () => undefined };
    signal.throwIfAborted();
    const { InterruptableStoppingCriteria } = await import('@huggingface/transformers');
    const stoppingCriteria = new InterruptableStoppingCriteria();
    const interrupt = (): void => stoppingCriteria.interrupt();
    signal.addEventListener('abort', interrupt, { once: true });
    if (signal.aborted) interrupt();
    return {
        stoppingCriteria,
        dispose: () => signal.removeEventListener('abort', interrupt)
    };
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export class TransformersInference {
    async embed(spec: ModelSpec, texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'wasm';
        const extractor = await getOrLoadPipeline(
            'feature-extraction',
            spec,
            device,
            options?.onProgress
        );
        options?.signal?.throwIfAborted();

        const result = (await extractor(texts, {
            pooling: 'mean',
            normalize: true
        })) as { data: Float32Array };
        options?.signal?.throwIfAborted();

        // result.data is a flat Float32Array; split into per-text vectors
        const data = result.data;
        const dims = data.length / texts.length;
        if (!Number.isInteger(dims) || dims <= 0) {
            throw new Error('Embedding pipeline returned an invalid vector shape');
        }
        const vectors: Float32Array[] = [];
        for (let i = 0; i < texts.length; i++) {
            vectors.push(data.subarray(i * dims, (i + 1) * dims));
        }
        return vectors;
    }

    async synthesize(
        spec: ModelSpec,
        text: string,
        options?: SynthesizeOptions
    ): Promise<SynthesizeResult> {
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'wasm';
        const synthesizer = await getOrLoadPipeline(
            'text-to-speech',
            spec,
            device,
            options?.onProgress
        );
        options?.signal?.throwIfAborted();

        const out = (await synthesizer(text, {})) as {
            audio: Float32Array;
            sampling_rate?: number;
        };
        options?.signal?.throwIfAborted();

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
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'webgpu';
        const generator = await getOrLoadPipeline(
            'text-generation',
            spec,
            device,
            options?.onProgress
        );
        options?.signal?.throwIfAborted();

        let resolvedMessages = messages;
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            resolvedMessages = messages.slice(0, -1);
        }

        const cancellation = await createGenerationCancellation(options?.signal);
        try {
            yield* streamGeneratedText(generator.tokenizer, (streamer) =>
                generator(resolvedMessages, {
                    streamer,
                    ...(cancellation.stoppingCriteria
                        ? { stopping_criteria: cancellation.stoppingCriteria }
                        : {}),
                    max_new_tokens: options?.max_new_tokens ?? 512,
                    temperature: options?.temperature ?? 0.7,
                    top_p: options?.top_p ?? 0.9,
                    top_k: options?.top_k ?? 50,
                    repetition_penalty: options?.repetition_penalty ?? 1.1,
                    do_sample: true
                })
            );
            options?.signal?.throwIfAborted();
        } finally {
            cancellation.dispose();
        }
    }

    async transcribe(
        spec: ModelSpec,
        audio: Blob | Float32Array,
        options?: TranscribeOptions
    ): Promise<TranscribeResult> {
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'wasm';
        const transcriber = await getOrLoadPipeline(
            'automatic-speech-recognition',
            spec,
            device,
            options?.onProgress
        );
        options?.signal?.throwIfAborted();

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
        options?.signal?.throwIfAborted();

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
        options?.signal?.throwIfAborted();
        const device = options?.device ?? 'wasm';
        const classifier = (await getOrLoadPipeline(
            'text-classification',
            spec,
            device,
            options?.onProgress
        )) as SequenceClassificationPipeline;
        options?.signal?.throwIfAborted();

        // A single-label text-classification pipeline applies softmax to one logit,
        // which is always 1. Cross-encoder rerankers instead need paired tokenization
        // and sigmoid-normalized raw logits.
        const inputs = classifier.tokenizer(
            documents.map(() => query),
            {
                text_pair: documents,
                padding: true,
                truncation: true
            }
        );
        const { logits } = await classifier.model(inputs);
        options?.signal?.throwIfAborted();
        if (logits.data.length !== documents.length) {
            throw new Error('Reranker returned an unexpected number of scores');
        }
        return Array.from(logits.data, sigmoid);
    }

    async dispose(modelId: string): Promise<void> {
        for (const [key, runtime] of runtimeCache) {
            if (key.includes(`::${modelId}::`)) {
                await runtime.dispose?.();
                runtimeCache.delete(key);
                logger.info(`Disposed runtime: ${key}`);
            }
        }
    }

    async disposeAll(): Promise<void> {
        for (const [key, runtime] of runtimeCache) {
            await runtime.dispose?.();
            logger.info(`Disposed runtime: ${key}`);
        }
        runtimeCache.clear();
    }
}

function sigmoid(value: number): number {
    if (value >= 0) return 1 / (1 + Math.exp(-value));
    const exponential = Math.exp(value);
    return exponential / (1 + exponential);
}

export const transformers = new TransformersInference();
