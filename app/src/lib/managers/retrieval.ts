import { createAsyncCache } from '$lib/adapters/cache';
import { sha256 } from '$lib/crypto';
import { selectEmbeddingHandler } from '$lib/embedding';
import { selectRerankerHandler, type RankedResult } from '$lib/reranker';
import { getAppSettings } from '$lib/stores';
import { AppError } from '$lib/types/errors';
import { LRUCache } from '$lib/utils/cache';

const QUERY_L1_CAPACITY = 32;
const QUERY_L2_CAPACITY = 100;
const DOCUMENT_L1_CAPACITY = 256;
const DOCUMENT_L2_CAPACITY = 1_000;
const EMBEDDING_BATCH_SIZE = 64;

const queryEmbeddingL1 = new LRUCache<string, Float32Array>(QUERY_L1_CAPACITY);
const documentEmbeddingL1 = new LRUCache<string, Float32Array>(DOCUMENT_L1_CAPACITY);
const queryEmbeddingL2 = createAsyncCache<number[]>(
    'normalized-embedding-query-vectors',
    QUERY_L2_CAPACITY
);
const documentEmbeddingL2 = createAsyncCache<number[]>(
    'normalized-embedding-document-vectors',
    DOCUMENT_L2_CAPACITY
);

export async function similarity(
    query: string,
    documents: string[],
    signal: AbortSignal,
    topK?: number
): Promise<RankedResult[]> {
    if (!query.trim()) {
        throw new AppError('INVALID_INPUT', 'Similarity query cannot be empty');
    }
    if (documents.length === 0) return [];
    if (topK !== undefined && (!Number.isInteger(topK) || topK <= 0)) {
        throw new AppError('INVALID_INPUT', 'Similarity topK must be a positive integer');
    }

    const settings = await getAppSettings();
    const selected = selectEmbeddingHandler(settings.embeddingProvider, settings);
    if (!selected) {
        throw new AppError('INVALID_INPUT', 'Failed to create embedding handler');
    }

    const uniqueDocuments = [...new Set(documents)];
    const [queryKey, uniqueDocumentKeys] = await Promise.all([
        sha256(`${selected.modelId}\0${query}`),
        Promise.all(uniqueDocuments.map((document) => sha256(`${selected.modelId}\0${document}`)))
    ]);
    const documentKeyByText = new Map(
        uniqueDocuments.map((document, index) => [document, uniqueDocumentKeys[index]])
    );
    const documentKeys = documents.map((document) => {
        const key = documentKeyByText.get(document);
        if (!key) throw new AppError('NETWORK_ERROR', 'Failed to resolve document cache key');
        return key;
    });
    signal.throwIfAborted();

    let queryVector = queryEmbeddingL1.get(queryKey);
    const documentVectors = new Map<string, Float32Array>();
    const documentL2Keys: string[] = [];
    for (const key of new Set(documentKeys)) {
        const vector = documentEmbeddingL1.get(key);
        if (vector) {
            documentVectors.set(key, vector);
        } else {
            documentL2Keys.push(key);
        }
    }

    const [cachedQueries, cachedDocuments] = await Promise.all([
        queryVector
            ? Promise.resolve(new Map<string, number[]>())
            : queryEmbeddingL2.getMany([queryKey]).catch(() => new Map<string, number[]>()),
        documentL2Keys.length > 0
            ? documentEmbeddingL2.getMany(documentL2Keys).catch(() => new Map<string, number[]>())
            : Promise.resolve(new Map<string, number[]>())
    ]);
    signal.throwIfAborted();

    const misses = new Map<string, string>();
    const invalidQueryKeys: string[] = [];
    const cachedQuery = cachedQueries.get(queryKey);
    if (!queryVector) {
        if (isNormalizedEmbeddingVector(cachedQuery)) {
            queryVector = toFloat32Vector(cachedQuery);
            queryEmbeddingL1.set(queryKey, queryVector);
        } else {
            if (cachedQuery !== undefined) invalidQueryKeys.push(queryKey);
            misses.set(queryKey, query);
        }
    }

    const invalidDocumentKeys: string[] = [];
    for (let index = 0; index < documentKeys.length; index += 1) {
        const key = documentKeys[index];
        if (documentVectors.has(key)) continue;

        const cached = cachedDocuments.get(key);
        if (isNormalizedEmbeddingVector(cached)) {
            const vector = toFloat32Vector(cached);
            documentVectors.set(key, vector);
            documentEmbeddingL1.set(key, vector);
        } else {
            if (cached !== undefined) invalidDocumentKeys.push(key);
            if (!misses.has(key)) misses.set(key, documents[index]);
        }
    }
    await Promise.all([
        invalidQueryKeys.length > 0
            ? queryEmbeddingL2.deleteMany(invalidQueryKeys).catch(() => undefined)
            : Promise.resolve(),
        invalidDocumentKeys.length > 0
            ? documentEmbeddingL2
                  .deleteMany([...new Set(invalidDocumentKeys)])
                  .catch(() => undefined)
            : Promise.resolve()
    ]);

    const queryL2Entries: Array<readonly [string, number[]]> = [];
    const documentL2Entries: Array<readonly [string, number[]]> = [];
    if (misses.size > 0) {
        const missingEntries = [...misses.entries()];
        const normalizedVectors: Float32Array[] = [];
        let expectedDimensions: number | undefined;
        for (let offset = 0; offset < missingEntries.length; offset += EMBEDDING_BATCH_SIZE) {
            const batch = missingEntries.slice(offset, offset + EMBEDDING_BATCH_SIZE);
            const { vectors } = await selected.handler.embed(
                batch.map(([, text]) => text),
                signal
            );
            signal.throwIfAborted();
            if (vectors.length !== batch.length) {
                throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector count');
            }
            for (const vector of vectors) {
                const normalized = normalizeEmbeddingVector(vector);
                expectedDimensions ??= normalized.length;
                if (normalized.length !== expectedDimensions) {
                    throw new AppError(
                        'NETWORK_ERROR',
                        'Embedding returned inconsistent vector lengths'
                    );
                }
                normalizedVectors.push(normalized);
            }
        }

        const vectorsByKey = new Map<string, Float32Array>();
        for (let index = 0; index < missingEntries.length; index += 1) {
            vectorsByKey.set(missingEntries[index][0], normalizedVectors[index]);
        }

        const missingQueryVector = vectorsByKey.get(queryKey);
        if (!queryVector && missingQueryVector) {
            queryVector = missingQueryVector;
            queryEmbeddingL1.set(queryKey, queryVector);
            queryL2Entries.push([queryKey, Array.from(missingQueryVector)]);
        }

        for (const key of new Set(documentKeys)) {
            if (documentVectors.has(key)) continue;
            const vector = vectorsByKey.get(key);
            if (!vector) continue;
            documentVectors.set(key, vector);
            documentEmbeddingL1.set(key, vector);
            documentL2Entries.push([key, Array.from(vector)]);
        }
    }

    if (queryL2Entries.length > 0) {
        void queryEmbeddingL2.setMany(queryL2Entries).catch(() => undefined);
    }
    if (documentL2Entries.length > 0) {
        void documentEmbeddingL2.setMany(documentL2Entries).catch(() => undefined);
    }

    signal.throwIfAborted();
    if (!queryVector) {
        throw new AppError('NETWORK_ERROR', 'Failed to resolve query embedding vector');
    }
    const vectors = documentKeys.map((key) => {
        const vector = documentVectors.get(key);
        if (!vector) {
            throw new AppError('NETWORK_ERROR', 'Failed to resolve document embedding vector');
        }
        return vector;
    });
    return rankByDotProduct(queryVector, vectors, topK);
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

function isNormalizedEmbeddingVector(value: number[] | undefined): value is number[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((component) => typeof component === 'number' && Number.isFinite(component))
    );
}

function normalizeEmbeddingVector(vector: Float32Array): Float32Array {
    if (
        !(vector instanceof Float32Array) ||
        vector.length === 0 ||
        !vector.every(Number.isFinite)
    ) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector');
    }

    let squaredMagnitude = 0;
    for (const component of vector) squaredMagnitude += component * component;
    const magnitude = Math.sqrt(squaredMagnitude);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector');
    }

    const normalized = new Float32Array(vector.length);
    for (let index = 0; index < vector.length; index += 1) {
        normalized[index] = vector[index] / magnitude;
        if (!Number.isFinite(normalized[index])) {
            throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector');
        }
    }
    return normalized;
}

function toFloat32Vector(vector: number[]): Float32Array {
    const converted = Float32Array.from(vector);
    if (!converted.every(Number.isFinite)) {
        throw new AppError('NETWORK_ERROR', 'Cached embedding vector is invalid');
    }
    return converted;
}

function dotProduct(left: ArrayLike<number>, right: ArrayLike<number>): number {
    if (left.length !== right.length) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned inconsistent vector lengths');
    }

    let dot = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
    }
    return dot;
}

function rankByDotProduct(
    query: Float32Array,
    documents: Float32Array[],
    topK: number | undefined
): RankedResult[] {
    if (topK === undefined || topK >= documents.length) {
        const results = documents.map((document, index) => ({
            index,
            score: dotProduct(query, document)
        }));
        results.sort(compareRankedResults);
        return results;
    }

    const heap: RankedResult[] = [];
    for (let index = 0; index < documents.length; index += 1) {
        const result = { index, score: dotProduct(query, documents[index]) };
        if (heap.length < topK) {
            heap.push(result);
            siftUp(heap, heap.length - 1);
        } else if (isBetterResult(result, heap[0])) {
            heap[0] = result;
            siftDown(heap, 0);
        }
    }
    heap.sort(compareRankedResults);
    return heap;
}

function siftUp(heap: RankedResult[], startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!isBetterResult(heap[parent], heap[index])) return;
        [heap[parent], heap[index]] = [heap[index], heap[parent]];
        index = parent;
    }
}

function siftDown(heap: RankedResult[], startIndex: number): void {
    let index = startIndex;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && isBetterResult(heap[smallest], heap[left])) smallest = left;
        if (right < heap.length && isBetterResult(heap[smallest], heap[right])) smallest = right;
        if (smallest === index) return;
        [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
        index = smallest;
    }
}

function isBetterResult(left: RankedResult, right: RankedResult): boolean {
    return left.score > right.score || (left.score === right.score && left.index < right.index);
}

function compareRankedResults(left: RankedResult, right: RankedResult): number {
    return right.score - left.score || left.index - right.index;
}
