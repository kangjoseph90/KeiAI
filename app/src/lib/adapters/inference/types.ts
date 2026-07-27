/**
 * Inference Adapter Interface — KeiAI
 *
 * Abstracts local AI model execution across platforms.
 * Web: @huggingface/transformers (ONNX WASM / WebGPU)
 * Tauri: native ONNX Runtime / candle (future)
 */

// ─── Device ──────────────────────────────────────────────────────────────────

/** Execution device for local model inference. */
export type InferenceDevice = 'wasm' | 'webgpu';

// ─── Model Spec ───────────────────────────────────────────────────────────────

/**
 * Identifies a model to load.
 * `modelId` is the HuggingFace model ID (e.g. `'Xenova/all-MiniLM-L6-v2'`)
 * or a local path for Tauri.
 */
export interface ModelSpec {
    modelId: string;
    /** HuggingFace revision (branch/tag/commit). Default: `'main'`. */
    revision?: string;
    /** dtype quantization, e.g. `'q8'`, `'fp32'`. Default: runtime-chosen. */
    quantization?: string;
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export type InferenceProgressStatus = 'download' | 'load' | 'ready';

export interface InferenceProgressEvent {
    status: InferenceProgressStatus;
    /** 0–1 during download, undefined otherwise */
    progress?: number;
    message?: string;
}

export type InferenceProgressCallback = (event: InferenceProgressEvent) => void;

// ─── Options ──────────────────────────────────────────────────────────────────

export interface EmbedOptions {
    device?: InferenceDevice;
    onProgress?: InferenceProgressCallback;
}

export interface SynthesizeOptions {
    device?: InferenceDevice;
    onProgress?: InferenceProgressCallback;
}

export interface GenerateOptions {
    device?: InferenceDevice;
    onProgress?: InferenceProgressCallback;
    max_new_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repetition_penalty?: number;
}

export interface TranscribeOptions {
    device?: InferenceDevice;
    onProgress?: InferenceProgressCallback;
    /** Language code, e.g. "en", "ko". Default: auto-detect. */
    language?: string;
}

export interface RerankOptions {
    device?: InferenceDevice;
    onProgress?: InferenceProgressCallback;
}

export interface TranscribeResult {
    text: string;
    segments?: { text: string; start: number; end: number }[];
}

export interface SynthesizeResult {
    audio: ArrayBuffer;
    sampleRate: number;
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface IInferenceAdapter {
    /**
     * Embed a batch of strings.
     * Returns one float vector per input text.
     */
    embed(spec: ModelSpec, texts: string[], options?: EmbedOptions): Promise<number[][]>;

    /**
     * Synthesize speech from text.
     * Yields raw PCM audio chunks (Float32Array data as ArrayBuffer).
     */
    synthesize(
        spec: ModelSpec,
        text: string,
        options?: SynthesizeOptions
    ): AsyncIterable<SynthesizeResult>;

    /**
     * Generate text via an LLM.
     * Yields stream chunks (tokens).
     */
    generate(
        spec: ModelSpec,
        messages: { role: string; content: string }[],
        options?: GenerateOptions
    ): AsyncIterable<string>;

    /**
     * Transcribe audio to text.
     * Returns the transcription with optional segment timestamps.
     */
    transcribe(
        spec: ModelSpec,
        audio: Blob | Float32Array,
        options?: TranscribeOptions
    ): Promise<TranscribeResult>;

    /**
     * Rerank documents against a query using a Cross-Encoder.
     * Returns an array of relevance scores corresponding to the documents.
     */
    rerank(
        spec: ModelSpec,
        query: string,
        documents: string[],
        options?: RerankOptions
    ): Promise<number[]>;

    /** Release a cached model pipeline to free memory. */
    dispose(modelId: string): Promise<void>;

    /** Release all cached model pipelines. */
    disposeAll(): Promise<void>;
}
