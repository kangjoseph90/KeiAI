export interface TTSStreamChunk {
	audio: ArrayBuffer;
}

export interface TTSStreamHandler {
	synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk>;
}
