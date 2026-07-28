import type { PluginInstance } from '$lib/plugins';
import type { STTHandler, STTResult } from '../types';

export class PluginSTTHandler implements STTHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
        signal?.throwIfAborted();
        const data = new Uint8Array(await audio.arrayBuffer());
        signal?.throwIfAborted();
        const result = await this.instance.broker.invoke<unknown>(
            this.fnId,
            [{ data, mimeType: audio.type }],
            signal
        );
        if (
            !result ||
            typeof result !== 'object' ||
            !('text' in result) ||
            typeof result.text !== 'string'
        ) {
            throw new Error('Plugin STT provider returned an invalid result');
        }
        return result as STTResult;
    }
}
