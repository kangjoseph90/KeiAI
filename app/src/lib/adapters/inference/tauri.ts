/**
 * Tauri Inference Adapter — KeiAI
 *
 * Stub implementation for Tauri desktop.
 * Native inference via Rust (ONNX Runtime / candle) is a future milestone.
 */

import type {
	IInferenceAdapter,
	ModelSpec,
	EmbedOptions,
	SynthesizeOptions,
	GenerateOptions,
	TranscribeOptions,
	TranscribeResult,
	RerankOptions
} from './types';

export class TauriInferenceAdapter implements IInferenceAdapter {
	async embed(_spec: ModelSpec, _texts: string[], _options?: EmbedOptions): Promise<number[][]> {
		throw new Error('Native inference not yet implemented. Use remote embedding providers.');
	}

	async *synthesize(
		_spec: ModelSpec,
		_text: string,
		_voiceId: string,
		_options?: SynthesizeOptions
	): AsyncIterable<ArrayBuffer> {
		// Throw before any yield — the unreachable yield satisfies the async generator return type.
		throw new Error('Native inference not yet implemented. Use remote TTS providers.');
		yield new ArrayBuffer(0);
	}

	async *generate(
		_spec: ModelSpec,
		_messages: { role: string; content: string }[],
		_options?: GenerateOptions
	): AsyncIterable<string> {
		throw new Error('Tauri inference not implemented yet');
		yield '';
	}

	async transcribe(
		_spec: ModelSpec,
		_audio: Blob | Float32Array,
		_options?: TranscribeOptions
	): Promise<TranscribeResult> {
		throw new Error('Native inference not yet implemented. Use remote STT providers.');
	}

	async rerank(
		_spec: ModelSpec,
		_query: string,
		_documents: string[],
		_options?: RerankOptions
	): Promise<number[]> {
		throw new Error('Native inference not yet implemented. Use remote Reranker providers.');
	}

	async dispose(_modelId: string): Promise<void> {
		// no-op
	}

	async disposeAll(): Promise<void> {
		// no-op
	}
}

export const tauriInference = new TauriInferenceAdapter();
