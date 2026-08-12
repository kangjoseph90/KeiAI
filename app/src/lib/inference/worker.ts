import { expose, transfer } from 'comlink';
import { transformers as transformersCore } from './transformers';
import { gemma4 as gemma4Core } from './gemma4';
import { qwen35 as qwen35Core } from './qwen35';
import { kokoro as kokoroCore } from './kokoro';
import type {
    AudioFileTransfer,
    EmbeddingTransfer,
    GenerationMessages,
    SynthesisTransfer,
    TransformersWorkerApi,
    WorkerMultimodalGenerateMessage
} from './worker-types';
import type { MultimodalGenerateMessage } from './types';

let operationTail: Promise<void> = Promise.resolve();
const operationControllers = new Map<string, AbortController>();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}

function enqueueInference<T>(
    operationId: string,
    operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const controller = new AbortController();
    operationControllers.set(operationId, controller);
    return enqueue(async () => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
    }).finally(() => operationControllers.delete(operationId));
}

function flattenVectors(vectors: Float32Array[]): EmbeddingTransfer {
    if (vectors.length === 0) return { data: new ArrayBuffer(0), count: 0, dimensions: 0 };
    const dimensions = vectors[0].length;
    const data = new Float32Array(vectors.length * dimensions);
    for (let index = 0; index < vectors.length; index += 1) {
        if (vectors[index].length !== dimensions) {
            throw new Error('Embedding returned inconsistent vector lengths');
        }
        data.set(vectors[index], index * dimensions);
    }
    return transfer({ data: data.buffer, count: vectors.length, dimensions }, [
        data.buffer
    ]) as EmbeddingTransfer;
}

const api: TransformersWorkerApi = {
    embed: (operationId, spec, texts, options, onProgress) =>
        enqueueInference(operationId, async (signal) =>
            flattenVectors(
                await transformersCore.embed(spec, texts, { ...options, onProgress, signal })
            )
        ),

    rerank: (operationId, spec, query, documents, options, onProgress) =>
        enqueueInference(operationId, (signal) =>
            transformersCore.rerank(spec, query, documents, { ...options, onProgress, signal })
        ),

    synthesize: (operationId, spec, text, options, onProgress) =>
        enqueueInference(operationId, async (signal) => {
            const result = await transformersCore.synthesize(spec, text, {
                ...options,
                onProgress,
                signal
            });
            return transfer(result, [result.audio]) as SynthesisTransfer;
        }),

    synthesizeKokoro: (operationId, text, voiceId) =>
        enqueueInference(operationId, async (signal) => {
            const data = await kokoroCore.synthesize(text, voiceId, signal);
            return transfer({ data: data.buffer, mimeType: 'audio/wav' }, [
                data.buffer
            ]) as AudioFileTransfer;
        }),

    transcribe: (operationId, spec, audio, options, onProgress) =>
        enqueueInference(operationId, (signal) =>
            transformersCore.transcribe(spec, audio, { ...options, onProgress, signal })
        ),

    generate: (operationId, kind, spec, messages, options, onText, onProgress) =>
        enqueueInference(operationId, async (signal) => {
            const stream =
                kind === 'pipeline'
                    ? transformersCore.generate(
                          spec,
                          messages as Array<{ role: string; content: string }>,
                          { ...options, onProgress, signal }
                      )
                    : kind === 'gemma4'
                      ? gemma4Core.generate(spec, messages as WorkerMultimodalGenerateMessage[], {
                            ...options,
                            onProgress,
                            signal
                        })
                      : qwen35Core.generate(spec, messages as MultimodalGenerateMessage[], {
                            ...options,
                            onProgress,
                            signal
                        });
            for await (const text of stream) await onText(text);
        }),

    cancel: async (operationId) => {
        operationControllers.get(operationId)?.abort();
    },

    dispose: (modelId) => enqueue(() => transformersCore.dispose(modelId)),
    disposeAll: () =>
        enqueue(async () => {
            await Promise.all([transformersCore.disposeAll(), kokoroCore.dispose()]);
        })
};

expose(api);
