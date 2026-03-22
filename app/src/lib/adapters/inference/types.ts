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
		voiceId: string,
		options?: SynthesizeOptions
	): AsyncIterable<ArrayBuffer>;

	/** Release a cached model pipeline to free memory. */
	dispose(modelId: string): Promise<void>;

	/** Release all cached model pipelines. */
	disposeAll(): Promise<void>;
}
