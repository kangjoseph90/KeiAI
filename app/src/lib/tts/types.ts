export interface TTSStreamChunk {
    data: Uint8Array<ArrayBuffer>;
    mimeType: string;
}

export interface TTSStreamHandler {
    synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk>;
}
