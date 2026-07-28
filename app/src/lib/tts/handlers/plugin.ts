import type { PluginInstance } from '$lib/plugins';
import type { TTSStreamChunk, TTSStreamHandler } from '../types';

export class PluginTTSStreamHandler implements TTSStreamHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk> {
        for await (const chunk of this.instance.broker.invokeStream<unknown>(
            this.fnId,
            [text],
            signal
        )) {
            if (
                !chunk ||
                typeof chunk !== 'object' ||
                !('data' in chunk) ||
                !(chunk.data instanceof Uint8Array) ||
                !('mimeType' in chunk) ||
                typeof chunk.mimeType !== 'string'
            ) {
                throw new Error('Plugin TTS provider returned invalid media');
            }
            yield {
                data: new Uint8Array(chunk.data),
                mimeType: chunk.mimeType
            };
        }
    }
}
