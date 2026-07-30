import type { PluginInstance } from '$lib/plugins';
import type { RerankerHandler, RerankerItem, RerankerResult } from '../types';

export class PluginRerankerHandler implements RerankerHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async rerank(
        query: string,
        documents: string[],
        signal?: AbortSignal
    ): Promise<RerankerResult> {
        const result = await this.instance.broker.invoke<unknown>(
            this.fnId,
            [query, documents],
            signal
        );
        if (!isRerankerResult(result)) {
            throw new Error('Plugin reranker provider returned an invalid result');
        }
        return {
            results: result.results.map((item) => ({ ...item }))
        };
    }
}

function isRerankerResult(value: unknown): value is RerankerResult {
    if (!value || typeof value !== 'object' || !('results' in value)) return false;
    return Array.isArray(value.results) && value.results.every(isRerankerItem);
}

function isRerankerItem(value: unknown): value is RerankerItem {
    if (!value || typeof value !== 'object') return false;
    if (!('index' in value) || !Number.isInteger(value.index)) return false;
    if (!('score' in value) || typeof value.score !== 'number' || !Number.isFinite(value.score)) {
        return false;
    }
    return !('text' in value) || value.text === undefined || typeof value.text === 'string';
}
