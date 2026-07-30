import { selectEmbeddingHandler } from '$lib/embedding';
import { selectRerankerHandler, type RankedResult } from '$lib/reranker';
import { getAppSettings } from '$lib/stores';
import { AppError } from '$lib/types/errors';

export async function similarity(
    query: string,
    documents: string[],
    signal: AbortSignal
): Promise<RankedResult[]> {
    if (!query.trim()) {
        throw new AppError('INVALID_INPUT', 'Similarity query cannot be empty');
    }
    if (documents.length === 0) return [];

    const settings = await getAppSettings();
    const selected = selectEmbeddingHandler(settings.embeddingProvider, settings);
    if (!selected) {
        throw new AppError('INVALID_INPUT', 'Failed to create embedding handler');
    }

    const { vectors } = await selected.handler.embed([query, ...documents], signal);
    signal.throwIfAborted();
    if (vectors.length !== documents.length + 1) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector count');
    }
    if (vectors.some((vector) => !isEmbeddingVector(vector))) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector');
    }

    const queryVector = vectors[0];
    const results = vectors.slice(1).map((vector, index) => ({
        index,
        score: cosineSimilarity(queryVector, vector)
    }));
    results.sort((a, b) => b.score - a.score);
    return results;
}

export async function rerank(
    query: string,
    documents: string[],
    signal: AbortSignal
): Promise<RankedResult[]> {
    if (!query.trim()) {
        throw new AppError('INVALID_INPUT', 'Reranker query cannot be empty');
    }
    if (documents.length === 0) return [];

    const settings = await getAppSettings();
    const handler = selectRerankerHandler(settings.rerankerProvider, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create reranker handler');
    }

    const results = await handler.rerank(query, documents, signal);
    signal.throwIfAborted();
    return results;
}

function isEmbeddingVector(value: number[] | undefined): value is number[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((component) => typeof component === 'number' && Number.isFinite(component))
    );
}

function cosineSimilarity(left: number[], right: number[]): number {
    if (left.length !== right.length) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned inconsistent vector lengths');
    }

    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftMagnitude += left[index] * left[index];
        rightMagnitude += right[index] * right[index];
    }

    const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
    return denominator === 0 ? 0 : dot / denominator;
}
