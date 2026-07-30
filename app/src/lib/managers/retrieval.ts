import { createAsyncCache } from '$lib/adapters/cache';
import { sha256 } from '$lib/crypto';
import { selectEmbeddingHandler } from '$lib/embedding';
import { selectRerankerHandler, type RankedResult } from '$lib/reranker';
import { getAppSettings } from '$lib/stores';
import { AppError } from '$lib/types/errors';

const embeddingCache = createAsyncCache<number[]>('embedding-vectors', 1_000);

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

    const texts = [query, ...documents];
    const cacheKeys = await Promise.all(
        texts.map((text) => sha256(`${selected.modelId}\0${text}`))
    );
    signal.throwIfAborted();

    const cachedVectors = await embeddingCache
        .getMany(cacheKeys)
        .catch(() => new Map<string, number[]>());
    signal.throwIfAborted();
    const vectorsByKey = new Map<string, number[]>();
    const misses = new Map<string, string>();
    const invalidKeys: string[] = [];
    for (let index = 0; index < texts.length; index += 1) {
        const key = cacheKeys[index];
        const cached = cachedVectors.get(key);
        if (isEmbeddingVector(cached)) {
            vectorsByKey.set(key, cached);
        } else {
            if (cached !== undefined) invalidKeys.push(key);
            if (!misses.has(key)) misses.set(key, texts[index]);
        }
    }
    if (invalidKeys.length > 0) {
        await embeddingCache.deleteMany(invalidKeys).catch(() => undefined);
    }

    if (misses.size > 0) {
        const missingEntries = [...misses.entries()];
        const { vectors } = await selected.handler.embed(
            missingEntries.map(([, text]) => text),
            signal
        );
        signal.throwIfAborted();
        if (vectors.length !== missingEntries.length) {
            throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector count');
        }
        if (vectors.some((vector) => !isEmbeddingVector(vector))) {
            throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector');
        }

        const cacheEntries: Array<readonly [string, number[]]> = [];
        for (let index = 0; index < missingEntries.length; index += 1) {
            const [key] = missingEntries[index];
            const vector = vectors[index];
            vectorsByKey.set(key, vector);
            cacheEntries.push([key, vector]);
        }
        await embeddingCache.setMany(cacheEntries).catch(() => undefined);
    }

    signal.throwIfAborted();
    const vectors = cacheKeys.map((key) => {
        const vector = vectorsByKey.get(key);
        if (!vector) {
            throw new AppError('NETWORK_ERROR', 'Failed to resolve embedding vector');
        }
        return vector;
    });
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
