import type { PluginInstance } from '$lib/plugins';
import type { RankedResult, RerankerHandler } from '../types';

export class PluginRerankerHandler implements RerankerHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async rerank(query: string, documents: string[], signal: AbortSignal): Promise<RankedResult[]> {
        const result = await this.instance.broker.invoke<unknown>(
            this.fnId,
            [query, documents],
            signal
        );
        if (!isRankedResults(result)) {
            throw new Error('Plugin reranker provider returned an invalid result');
        }
        return result.map((item) => ({ ...item }));
    }
}

function isRankedResults(value: unknown): value is RankedResult[] {
    return Array.isArray(value) && value.every(isRankedResult);
}

function isRankedResult(value: unknown): value is RankedResult {
    if (!value || typeof value !== 'object') return false;
    if (!('index' in value) || !Number.isInteger(value.index)) return false;
    if (!('score' in value) || typeof value.score !== 'number' || !Number.isFinite(value.score)) {
        return false;
    }
    return true;
}
