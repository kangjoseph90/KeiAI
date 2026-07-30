import type { PluginInstance } from '$lib/plugins';
import type { TTSHandler, TTSResult } from '../types';

export class PluginTTSHandler implements TTSHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async synthesize(text: string, signal: AbortSignal): Promise<TTSResult> {
        const media = await this.instance.broker.invoke<unknown>(this.fnId, [text], signal);
        if (
            !media ||
            typeof media !== 'object' ||
            !('data' in media) ||
            !(media.data instanceof Uint8Array) ||
            !('mimeType' in media) ||
            typeof media.mimeType !== 'string'
        ) {
            throw new Error('Plugin TTS provider returned invalid media');
        }
        return {
            data: new Uint8Array(media.data),
            mimeType: media.mimeType
        };
    }
}
