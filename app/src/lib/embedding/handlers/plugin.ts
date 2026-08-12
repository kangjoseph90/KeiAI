import type { PluginInstance } from '$lib/plugins';
import type { DocumentEmbeddingResult, EmbeddingHandler, EmbeddingResult } from '../types';

export class PluginEmbeddingHandler implements EmbeddingHandler {
    constructor(
        private readonly instance: PluginInstance,
        private readonly fnId: string
    ) {}

    async embedQuery(queries: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        signal?.throwIfAborted();
        if (queries.length === 0) return { vectors: [] };
        const result = await this.instance.broker.invoke<unknown>(
            this.fnId,
            ['query', queries],
            signal
        );
        if (!isEmbeddingResult(result, queries.length)) {
            throw new Error('Plugin embedding provider returned an invalid result');
        }
        return result;
    }

    async embedDocuments(
        documents: string[][],
        signal?: AbortSignal
    ): Promise<DocumentEmbeddingResult> {
        signal?.throwIfAborted();
        if (documents.length === 0) return { vectors: [] };
        const result = await this.instance.broker.invoke<unknown>(
            this.fnId,
            ['document', documents],
            signal
        );
        if (
            !isDocumentEmbeddingResult(
                result,
                documents.map((document) => document.length)
            )
        ) {
            throw new Error('Plugin embedding provider returned an invalid result');
        }
        return result;
    }
}

function isEmbeddingResult(value: unknown, expectedCount: number): value is EmbeddingResult {
    if (!value || typeof value !== 'object' || !('vectors' in value)) return false;
    return (
        Array.isArray(value.vectors) &&
        value.vectors.length === expectedCount &&
        value.vectors.every(isVector)
    );
}

function isDocumentEmbeddingResult(
    value: unknown,
    expectedGroupSizes: number[]
): value is DocumentEmbeddingResult {
    if (!value || typeof value !== 'object' || !('vectors' in value)) return false;
    return (
        Array.isArray(value.vectors) &&
        value.vectors.length === expectedGroupSizes.length &&
        value.vectors.every(
            (group, index) =>
                Array.isArray(group) &&
                group.length === expectedGroupSizes[index] &&
                group.every(isVector)
        )
    );
}

function isVector(vector: unknown): vector is Float32Array {
    return (
        vector instanceof Float32Array &&
        vector.length > 0 &&
        vector.every((component) => typeof component === 'number' && Number.isFinite(component))
    );
}
