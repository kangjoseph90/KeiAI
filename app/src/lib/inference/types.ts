/**
 * Local Inference Types — KeiAI
 *
 * Shared types for local model execution.
 */

// ─── Device ──────────────────────────────────────────────────────────────────

/** Execution device for local model inference. */
export type InferenceDevice = 'wasm' | 'webgpu';
export type InferenceDType =
    | 'auto'
    | 'fp32'
    | 'fp16'
    | 'q8'
    | 'int8'
    | 'uint8'
    | 'q4'
    | 'bnb4'
    | 'q4f16'
    | 'q2'
    | 'q2f16'
    | 'q1'
    | 'q1f16';

// ─── Model Spec ───────────────────────────────────────────────────────────────

/**
 * Identifies a model to load.
 * `modelId` is the HuggingFace model ID (e.g. `'Xenova/all-MiniLM-L6-v2'`).
 */
export interface ModelSpec {
    modelId: string;
    /** HuggingFace revision (branch/tag/commit). Default: `'main'`. */
    revision?: string;
    /** dtype quantization, e.g. `'q8'`, `'fp32'`. Default: runtime-chosen. */
    quantization?: InferenceDType;
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

export type MultimodalGeneratePart =
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'audio'; mimeType: string; data: string };

export interface MultimodalGenerateMessage {
    role: string;
    content: MultimodalGeneratePart[];
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
