import type { PluginInstance } from '$lib/plugins';
import type { EmbeddingHandler, EmbeddingResult } from '../types';

export class PluginEmbeddingHandler implements EmbeddingHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        const result = await this.instance.broker.invoke<unknown>(this.fnId, [texts], signal);
        if (!isEmbeddingResult(result)) {
            throw new Error('Plugin embedding provider returned an invalid result');
        }
        return {
            vectors: result.vectors.map((vector) => [...vector])
        };
    }
}

function isEmbeddingResult(value: unknown): value is EmbeddingResult {
    if (!value || typeof value !== 'object' || !('vectors' in value)) return false;
    if (!Array.isArray(value.vectors)) return false;
    return value.vectors.every(
        (vector) =>
            Array.isArray(vector) &&
            vector.every((component) => typeof component === 'number' && Number.isFinite(component))
    );
}
