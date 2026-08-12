import type {
    EmbedOptions,
    GenerateOptions,
    InferenceProgressCallback,
    ModelSpec,
    MultimodalGenerateMessage,
    RerankOptions,
    SynthesizeOptions,
    TranscribeOptions,
    TranscribeResult
} from './types';
import type { KokoroVoiceId } from '$lib/types/models/tts';

export type WorkerEmbedOptions = Omit<EmbedOptions, 'onProgress' | 'signal'>;
export type WorkerRerankOptions = Omit<RerankOptions, 'onProgress' | 'signal'>;
export type WorkerSynthesizeOptions = Omit<SynthesizeOptions, 'onProgress' | 'signal'>;
export type WorkerTranscribeOptions = Omit<TranscribeOptions, 'onProgress' | 'signal'>;
export type WorkerGenerateOptions = Omit<GenerateOptions, 'onProgress' | 'signal'>;

export interface EmbeddingTransfer {
    data: ArrayBuffer;
    count: number;
    dimensions: number;
}

export interface SynthesisTransfer {
    audio: ArrayBuffer;
    sampleRate: number;
}

export interface AudioFileTransfer {
    data: ArrayBuffer;
    mimeType: string;
}

export type GenerationKind = 'pipeline' | 'gemma4' | 'qwen35';
export type WorkerMultimodalGenerateMessage = {
    role: string;
    content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; mimeType: string; data: string }
        | { type: 'audio'; samples: Float32Array }
    >;
};
export type GenerationMessages =
    | Array<{ role: string; content: string }>
    | MultimodalGenerateMessage[]
    | WorkerMultimodalGenerateMessage[];

export type TextSink = (text: string) => Promise<void> | void;

export interface TransformersWorkerApi {
    embed(
        operationId: string,
        spec: ModelSpec,
        texts: string[],
        options: WorkerEmbedOptions,
        onProgress?: InferenceProgressCallback
    ): Promise<EmbeddingTransfer>;
    rerank(
        operationId: string,
        spec: ModelSpec,
        query: string,
        documents: string[],
        options: WorkerRerankOptions,
        onProgress?: InferenceProgressCallback
    ): Promise<number[]>;
    synthesize(
        operationId: string,
        spec: ModelSpec,
        text: string,
        options: WorkerSynthesizeOptions,
        onProgress?: InferenceProgressCallback
    ): Promise<SynthesisTransfer>;
    synthesizeKokoro(
        operationId: string,
        text: string,
        voiceId: KokoroVoiceId
    ): Promise<AudioFileTransfer>;
    transcribe(
        operationId: string,
        spec: ModelSpec,
        audio: Float32Array,
        options: WorkerTranscribeOptions,
        onProgress?: InferenceProgressCallback
    ): Promise<TranscribeResult>;
    generate(
        operationId: string,
        kind: GenerationKind,
        spec: ModelSpec,
        messages: GenerationMessages,
        options: WorkerGenerateOptions,
        onText: TextSink,
        onProgress?: InferenceProgressCallback
    ): Promise<void>;
    cancel(operationId: string): Promise<void>;
    dispose(modelId: string): Promise<void>;
    disposeAll(): Promise<void>;
}
