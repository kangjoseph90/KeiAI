/**
 * Web Inference Adapter — KeiAI
 *
 * Local model execution via @huggingface/transformers (ONNX WASM / WebGPU).
 * Pipelines are lazy-loaded and cached by modelId to avoid repeated init cost.
 *
 * Note: Runs on the main thread. Worker isolation is a future optimization
 * (requires SharedArrayBuffer + COOP/COEP headers for Transferable).
 */

import type {
	IInferenceAdapter,
	ModelSpec,
	EmbedOptions,
	SynthesizeOptions,
	InferenceProgressCallback
} from './types';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:inference:web');

// ─── Pipeline Cache ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any;
const pipelineCache = new Map<string, AnyPipeline>();

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
): Promise<AnyPipeline> {
	const key = cacheKey(task, spec.modelId, device);
	const cached = pipelineCache.get(key);
	if (cached) return cached;

	logger.info(`Loading pipeline: ${key}`);
	const { pipeline } = await import('@huggingface/transformers');

	const p = await pipeline(task as Parameters<typeof pipeline>[0], spec.modelId, {
		revision: spec.revision,
		dtype: (spec.quantization ?? 'q8') as 'q8' | 'fp32' | 'fp16' | 'int8' | 'uint8' | 'q4' | 'auto',
		device: device as 'wasm' | 'webgpu',
		progress_callback: toProgressCallback(onProgress)
	});

	pipelineCache.set(key, p);
	onProgress?.({ status: 'ready' });
	logger.info(`Pipeline ready: ${key}`);
	return p;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WebInferenceAdapter implements IInferenceAdapter {
	async embed(spec: ModelSpec, texts: string[], options?: EmbedOptions): Promise<number[][]> {
		const device = options?.device ?? 'wasm';
		const extractor = await getOrLoadPipeline(
			'feature-extraction',
			spec,
			device,
			options?.onProgress
		);

		const result = await extractor(texts, { pooling: 'mean', normalize: true });

		// result.data is a flat Float32Array; split into per-text vectors
		const data = result.data as Float32Array;
		const dims = data.length / texts.length;
		const vectors: number[][] = [];
		for (let i = 0; i < texts.length; i++) {
			vectors.push(Array.from(data.subarray(i * dims, (i + 1) * dims)));
		}
		return vectors;
	}

	async *synthesize(
		spec: ModelSpec,
		text: string,
		_voiceId: string,
		options?: SynthesizeOptions
	): AsyncIterable<ArrayBuffer> {
		const device = options?.device ?? 'wasm';
		const synthesizer = await getOrLoadPipeline(
			'text-to-speech',
			spec,
			device,
			options?.onProgress
		);

		// `voiceId` is passed through speakerEmbeddings for VITS models that support it.
		// For models that don't, it's a no-op.
		const out = await synthesizer(text, {});

		// `out.audio` is a Float32Array of PCM samples; yield as a single chunk.
		// Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer incompatibility.
		const audio = out.audio as Float32Array;
		const copy = new ArrayBuffer(audio.byteLength);
		new Uint8Array(copy).set(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength));
		yield copy;
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

export const webInference = new WebInferenceAdapter();
