import { proxy, releaseProxy, transfer, wrap, type Remote } from 'comlink';
import { fromBase64 } from '$lib/crypto';
import { decodeAudio } from '$lib/utils/audio';
import type {
    EmbedOptions,
    GenerateOptions,
    InferenceProgressCallback,
    ModelSpec,
    MultimodalGenerateMessage,
    RerankOptions,
    SynthesizeOptions,
    SynthesizeResult,
    TranscribeOptions,
    TranscribeResult
} from './types';
import type {
    GenerationKind,
    GenerationMessages,
    TransformersWorkerApi,
    WorkerMultimodalGenerateMessage
} from './worker-types';

type ReleasableCallback<T extends (...args: never[]) => unknown> = T & {
    [releaseProxy]?: () => void;
};

let workerInstance: Worker | null = null;
let remoteInstance: Remote<TransformersWorkerApi> | null = null;
let nextOperationId = 0;

function createOperationId(): string {
    nextOperationId += 1;
    return `inference-${nextOperationId}`;
}

function abortError(signal: AbortSignal): unknown {
    return signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted', 'AbortError');
}

async function runAbortable<T>(
    signal: AbortSignal | undefined,
    invoke: (operationId: string) => Promise<T>
): Promise<T> {
    signal?.throwIfAborted();
    const operationId = createOperationId();
    const remote = getRemote();
    const operation = invoke(operationId);
    if (!signal) return operation;

    let rejectAbort: (reason: unknown) => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => (rejectAbort = reject));
    const onAbort = (): void => {
        void remote.cancel(operationId).catch(() => undefined);
        rejectAbort(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
        return await Promise.race([operation, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

function getRemote(): Remote<TransformersWorkerApi> {
    if (remoteInstance) return remoteInstance;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    try {
        const remote = wrap<TransformersWorkerApi>(worker);
        workerInstance = worker;
        remoteInstance = remote;
        return remote;
    } catch (error) {
        worker.terminate();
        throw error;
    }
}

function createProgressProxy(
    onProgress?: InferenceProgressCallback
): ReleasableCallback<InferenceProgressCallback> | undefined {
    return onProgress
        ? (proxy(onProgress) as ReleasableCallback<InferenceProgressCallback>)
        : undefined;
}

function releaseCallback<T extends (...args: never[]) => unknown>(
    callback: ReleasableCallback<T> | undefined
): void {
    callback?.[releaseProxy]?.();
}

class AsyncTextQueue {
    private readonly values: string[] = [];
    private readonly waiters: Array<() => void> = [];
    private completed = false;
    private failure: unknown;

    push(value: string): void {
        this.values.push(value);
        this.waiters.shift()?.();
    }

    finish(): void {
        this.completed = true;
        this.waiters.shift()?.();
    }

    fail(error: unknown): void {
        this.values.length = 0;
        this.failure = error;
        this.completed = true;
        this.waiters.shift()?.();
    }

    async next(): Promise<IteratorResult<string>> {
        while (this.values.length === 0 && !this.completed) {
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        if (this.values.length > 0) return { value: this.values.shift()!, done: false };
        if (this.failure !== undefined) throw this.failure;
        return { value: undefined, done: true };
    }
}

export class TransformersWorkerClient {
    async embed(
        spec: ModelSpec,
        texts: string[],
        options: EmbedOptions = {}
    ): Promise<Float32Array[]> {
        const { onProgress, signal, ...workerOptions } = options;
        const progress = createProgressProxy(onProgress);
        try {
            const result = await runAbortable(signal, (operationId) =>
                getRemote().embed(operationId, spec, texts, workerOptions, progress)
            );
            const data = new Float32Array(result.data);
            return Array.from({ length: result.count }, (_, index) =>
                data.subarray(index * result.dimensions, (index + 1) * result.dimensions)
            );
        } finally {
            releaseCallback(progress);
        }
    }

    async rerank(
        spec: ModelSpec,
        query: string,
        documents: string[],
        options: RerankOptions = {}
    ): Promise<number[]> {
        const { onProgress, signal, ...workerOptions } = options;
        const progress = createProgressProxy(onProgress);
        try {
            return await runAbortable(signal, (operationId) =>
                getRemote().rerank(operationId, spec, query, documents, workerOptions, progress)
            );
        } finally {
            releaseCallback(progress);
        }
    }

    async synthesize(
        spec: ModelSpec,
        text: string,
        options: SynthesizeOptions = {}
    ): Promise<SynthesizeResult> {
        const { onProgress, signal, ...workerOptions } = options;
        const progress = createProgressProxy(onProgress);
        try {
            return await runAbortable(signal, (operationId) =>
                getRemote().synthesize(operationId, spec, text, workerOptions, progress)
            );
        } finally {
            releaseCallback(progress);
        }
    }

    async transcribe(
        spec: ModelSpec,
        audio: Blob | Float32Array,
        options: TranscribeOptions = {}
    ): Promise<TranscribeResult> {
        options.signal?.throwIfAborted();
        const samples =
            audio instanceof Blob
                ? await decodeAudio(await audio.arrayBuffer())
                : new Float32Array(audio);
        options.signal?.throwIfAborted();
        const { onProgress, signal, ...workerOptions } = options;
        const progress = createProgressProxy(onProgress);
        try {
            return await runAbortable(signal, (operationId) =>
                getRemote().transcribe(
                    operationId,
                    spec,
                    transfer(samples, [samples.buffer]),
                    workerOptions,
                    progress
                )
            );
        } finally {
            releaseCallback(progress);
        }
    }

    generate(
        kind: GenerationKind,
        spec: ModelSpec,
        messages: GenerationMessages,
        options: GenerateOptions = {}
    ): AsyncIterable<string> {
        return this.streamGeneration(kind, spec, messages, options);
    }

    private async *streamGeneration(
        kind: GenerationKind,
        spec: ModelSpec,
        messages: GenerationMessages,
        options: GenerateOptions
    ): AsyncIterable<string> {
        const queue = new AsyncTextQueue();
        options.signal?.throwIfAborted();
        const operationId = createOperationId();
        const remote = getRemote();
        const sink = proxy((text: string) => {
            if (!signal?.aborted) queue.push(text);
        }) as ReleasableCallback<(text: string) => void>;
        const { onProgress, signal, ...workerOptions } = options;
        const progress = createProgressProxy(onProgress);
        const onAbort = (): void => {
            void remote.cancel(operationId).catch(() => undefined);
            queue.fail(abortError(signal!));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        const operation = Promise.resolve()
            .then(async () => {
                const workerMessages =
                    kind === 'gemma4'
                        ? await decodeGemmaAudio(messages as MultimodalGenerateMessage[])
                        : messages;
                signal?.throwIfAborted();
                return remote.generate(
                    operationId,
                    kind,
                    spec,
                    workerMessages,
                    workerOptions,
                    sink,
                    progress
                );
            })
            .then(() => queue.finish())
            .catch((error: unknown) => queue.fail(error));
        try {
            while (true) {
                const item = await queue.next();
                if (item.done) break;
                yield item.value;
            }
            await operation;
        } finally {
            signal?.removeEventListener('abort', onAbort);
            void remote.cancel(operationId).catch(() => undefined);
            releaseCallback(sink);
            releaseCallback(progress);
        }
    }

    async dispose(modelId: string): Promise<void> {
        await getRemote().dispose(modelId);
    }

    async disposeAll(): Promise<void> {
        if (!remoteInstance) return;
        try {
            await remoteInstance.disposeAll();
        } finally {
            remoteInstance[releaseProxy]?.();
            workerInstance?.terminate();
            remoteInstance = null;
            workerInstance = null;
        }
    }
}

const client = new TransformersWorkerClient();

export const transformers = {
    embed: client.embed.bind(client),
    rerank: client.rerank.bind(client),
    synthesize: client.synthesize.bind(client),
    transcribe: client.transcribe.bind(client),
    generate: (
        spec: ModelSpec,
        messages: Array<{ role: string; content: string }>,
        options?: GenerateOptions
    ) => client.generate('pipeline', spec, messages, options),
    dispose: client.dispose.bind(client),
    disposeAll: client.disposeAll.bind(client)
};

export const gemma4 = {
    generate: (spec: ModelSpec, messages: MultimodalGenerateMessage[], options?: GenerateOptions) =>
        client.generate('gemma4', spec, messages, options)
};

export const qwen35 = {
    generate: (spec: ModelSpec, messages: MultimodalGenerateMessage[], options?: GenerateOptions) =>
        client.generate('qwen35', spec, messages, options)
};

async function decodeGemmaAudio(
    messages: MultimodalGenerateMessage[]
): Promise<WorkerMultimodalGenerateMessage[]> {
    return Promise.all(
        messages.map(async (message) => ({
            role: message.role,
            content: await Promise.all(
                message.content.map(async (part) => {
                    if (part.type !== 'audio') return part;
                    const blob = new Blob([fromBase64(part.data)], { type: part.mimeType });
                    return {
                        type: 'audio' as const,
                        samples: await decodeAudio(await blob.arrayBuffer())
                    };
                })
            )
        }))
    );
}
