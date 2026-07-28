import type { PluginInstance } from '$lib/plugins';
import type { ImageGenHandler, ImageGenImage, ImageGenRequest } from '../types';

export class PluginImageGenHandler implements ImageGenHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenImage> {
        const media = await this.instance.broker.invoke<unknown>(this.fnId, [request], signal);
        if (
            !media ||
            typeof media !== 'object' ||
            !('data' in media) ||
            !(media.data instanceof Uint8Array) ||
            !('mimeType' in media) ||
            typeof media.mimeType !== 'string'
        ) {
            throw new Error('Plugin image provider returned invalid media');
        }
        return {
            data: new Uint8Array(media.data),
            mimeType: media.mimeType
        };
    }
}
