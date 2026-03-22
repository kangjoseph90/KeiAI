export interface TTSStreamChunk {
	audio: ArrayBuffer;
}

export interface TTSStreamProvider {
	synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk>;
}
