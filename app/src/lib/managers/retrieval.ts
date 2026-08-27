import { createAsyncCache } from '$lib/adapters/cache';
import { sha256 } from '$lib/crypto';
import { selectEmbeddingHandler } from '$lib/embedding';
import { selectRerankerHandler, type RankedResult } from '$lib/reranker';
import { getAppSettings } from '$lib/stores';
import { AppError } from '$lib/types/errors';
import { LRUCache } from '$lib/utils/cache';

const QUERY_L1_CAPACITY = 32;
const QUERY_L2_CAPACITY = 100;
/** 64 MiB of resident vectors ≈ 21k chunks at 768d / 10.9k at 1536d. */
const DOCUMENT_L1_BYTE_BUDGET = 64 * 1024 * 1024;
const DOCUMENT_L2_CAPACITY = 16_384;
const EMBEDDING_BATCH_CHUNKS = 64;

export interface RetrievalDocument {
    /** Ordered chunks from one source document. Chunks in a group may share embedding context. */
    chunks: string[];
}

export interface DocumentSearchResult {
    documentIndex: number;
    chunkIndex: number;
    score: number;
}

interface EmbeddedCandidate {
    documentIndex: number;
    chunkIndex: number;
    vector: Float32Array;
}

const queryEmbeddingL1 = new LRUCache<string, Float32Array>(QUERY_L1_CAPACITY);
const documentEmbeddingL1 = new LRUCache<string, Float32Array>(DOCUMENT_L1_BYTE_BUDGET, {
    estimateSize: (vector) => vector.byteLength
});
const queryEmbeddingL2 = createAsyncCache<Float32Array>(
    'normalized-embedding-query-vectors',
    QUERY_L2_CAPACITY
);
const documentEmbeddingL2 = createAsyncCache<Float32Array>(
    'normalized-embedding-document-vectors',
    DOCUMENT_L2_CAPACITY
);

export async function searchChunks(
    query: string,
    chunks: string[],
    signal: AbortSignal,
    topK?: number
): Promise<RankedResult[]> {
    const results = await searchDocuments(
        query,
        chunks.map((chunk) => ({ chunks: [chunk] })),
        signal,
        topK
    );
    return results.map(({ documentIndex: index, score }) => ({ index, score }));
}

export async function searchDocuments(
    query: string,
    documents: RetrievalDocument[],
    signal: AbortSignal,
    topK?: number
): Promise<DocumentSearchResult[]> {
    if (!query.trim()) {
        throw new AppError('INVALID_INPUT', 'Search query cannot be empty');
    }
    if (documents.length === 0) return [];
    if (documents.some((document) => document.chunks.length === 0)) {
        throw new AppError('INVALID_INPUT', 'Search documents must contain at least one chunk');
    }
    if (topK !== undefined && (!Number.isInteger(topK) || topK <= 0)) {
        throw new AppError('INVALID_INPUT', 'Search topK must be a positive integer');
    }

    const settings = await getAppSettings();
    const selected = selectEmbeddingHandler(settings.embeddingProvider, settings);
    if (!selected) {
        throw new AppError('INVALID_INPUT', 'Failed to create embedding handler');
    }

    const [queryKey, documentGroupKeys] = await Promise.all([
        sha256(`${selected.modelId}\0query\0${query}`),
        Promise.all(
            documents.map((document) =>
                sha256(`${selected.modelId}\0document\0${JSON.stringify(document.chunks)}`)
            )
        )
    ]);
    const documentVectorKeys = documents.map((document, documentIndex) =>
        document.chunks.map((_, chunkIndex) => `${documentGroupKeys[documentIndex]}\0${chunkIndex}`)
    );
    const uniqueDocumentVectorKeys = [...new Set(documentVectorKeys.flat())];
    signal.throwIfAborted();

    let queryVector = queryEmbeddingL1.get(queryKey);
    const documentVectors = new Map<string, Float32Array>();
    const documentL2Keys: string[] = [];
    for (const key of uniqueDocumentVectorKeys) {
        const vector = documentEmbeddingL1.get(key);
        if (vector) {
            documentVectors.set(key, vector);
        } else {
            documentL2Keys.push(key);
        }
    }

    const [cachedQueries, cachedDocuments] = await Promise.all([
        queryVector
            ? Promise.resolve(new Map<string, Float32Array>())
            : queryEmbeddingL2.getMany([queryKey]).catch(() => new Map<string, Float32Array>()),
        documentL2Keys.length > 0
            ? documentEmbeddingL2
                  .getMany(documentL2Keys)
                  .catch(() => new Map<string, Float32Array>())
            : Promise.resolve(new Map<string, Float32Array>())
    ]);
    signal.throwIfAborted();

    if (!queryVector) {
        const cachedQuery = cachedQueries.get(queryKey);
        if (cachedQuery) {
            queryVector = cachedQuery;
            queryEmbeddingL1.set(queryKey, queryVector);
        }
    }

    for (const key of uniqueDocumentVectorKeys) {
        if (documentVectors.has(key)) continue;

        const cached = cachedDocuments.get(key);
        if (cached) {
            documentVectors.set(key, cached);
            documentEmbeddingL1.set(key, cached);
        }
    }

    const queryL2Entries: Array<readonly [string, Float32Array]> = [];
    const documentL2Entries: Array<readonly [string, Float32Array]> = [];
    if (!queryVector) {
        const { vectors } = await selected.handler.embedQuery([query], signal);
        signal.throwIfAborted();
        if (vectors.length !== 1) {
            throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid query vector count');
        }
        queryVector = normalizeEmbeddingVector(vectors[0]);
        queryEmbeddingL1.set(queryKey, queryVector);
        queryL2Entries.push([queryKey, queryVector]);
    }
    const expectedDimensions = queryVector.length;

    const missingGroups = new Map<string, { chunks: string[]; vectorKeys: string[] }>();
    for (let index = 0; index < documents.length; index += 1) {
        const vectorKeys = documentVectorKeys[index];
        if (vectorKeys.every((key) => documentVectors.has(key))) continue;
        missingGroups.set(documentGroupKeys[index], {
            chunks: documents[index].chunks,
            vectorKeys
        });
    }

    for (const batch of batchDocumentGroups([...missingGroups.values()])) {
        const { vectors } = await selected.handler.embedDocuments(
            batch.map((entry) => entry.chunks),
            signal
        );
        signal.throwIfAborted();
        if (vectors.length !== batch.length) {
            throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid document count');
        }

        for (let groupIndex = 0; groupIndex < batch.length; groupIndex += 1) {
            const entry = batch[groupIndex];
            const groupVectors = vectors[groupIndex];
            if (groupVectors.length !== entry.vectorKeys.length) {
                throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid chunk count');
            }
            for (let chunkIndex = 0; chunkIndex < groupVectors.length; chunkIndex += 1) {
                const normalized = normalizeEmbeddingVector(groupVectors[chunkIndex]);
                if (normalized.length !== expectedDimensions) {
                    throw new AppError(
                        'NETWORK_ERROR',
                        'Embedding returned inconsistent vector lengths'
                    );
                }
                const key = entry.vectorKeys[chunkIndex];
                documentVectors.set(key, normalized);
                documentEmbeddingL1.set(key, normalized);
                documentL2Entries.push([key, normalized]);
            }
        }
    }

    if (queryL2Entries.length > 0) {
        void queryEmbeddingL2.setMany(queryL2Entries).catch(() => undefined);
    }
    if (documentL2Entries.length > 0) {
        void documentEmbeddingL2.setMany(documentL2Entries).catch(() => undefined);
    }

    signal.throwIfAborted();
    const candidates: EmbeddedCandidate[] = [];
    for (let documentIndex = 0; documentIndex < documentVectorKeys.length; documentIndex += 1) {
        for (
            let chunkIndex = 0;
            chunkIndex < documentVectorKeys[documentIndex].length;
            chunkIndex += 1
        ) {
            const vector = documentVectors.get(documentVectorKeys[documentIndex][chunkIndex]);
            if (!vector) {
                throw new AppError('NETWORK_ERROR', 'Failed to resolve document embedding vector');
            }
            candidates.push({ documentIndex, chunkIndex, vector });
        }
    }
    return rankByDotProduct(queryVector, candidates, topK);
}

function batchDocumentGroups<T extends { chunks: string[] }>(groups: T[]): T[][] {
    const batches: T[][] = [];
    let batch: T[] = [];
    let chunkCount = 0;

    for (const group of groups) {
        if (batch.length > 0 && chunkCount + group.chunks.length > EMBEDDING_BATCH_CHUNKS) {
            batches.push(batch);
            batch = [];
            chunkCount = 0;
        }
        batch.push(group);
        chunkCount += group.chunks.length;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
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

function dotProduct(left: ArrayLike<number>, right: ArrayLike<number>): number {
    if (left.length !== right.length) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned inconsistent vector lengths');
    }

    // One accumulator keeps scalar addition order, so scores are bit-identical.
    let dot = 0;
    let index = 0;
    const unrolledLength = left.length - (left.length % 4);
    for (; index < unrolledLength; index += 4) {
        dot += left[index] * right[index];
        dot += left[index + 1] * right[index + 1];
        dot += left[index + 2] * right[index + 2];
        dot += left[index + 3] * right[index + 3];
    }
    for (; index < left.length; index += 1) {
        dot += left[index] * right[index];
    }
    return dot;
}

function rankByDotProduct(
    query: Float32Array,
    candidates: EmbeddedCandidate[],
    topK: number | undefined
): DocumentSearchResult[] {
    if (topK === undefined || topK >= candidates.length) {
        const results = candidates.map((candidate) => ({
            documentIndex: candidate.documentIndex,
            chunkIndex: candidate.chunkIndex,
            score: dotProduct(query, candidate.vector)
        }));
        results.sort(compareDocumentSearchResults);
        return results;
    }

    const heap: DocumentSearchResult[] = [];
    for (const candidate of candidates) {
        const result = {
            documentIndex: candidate.documentIndex,
            chunkIndex: candidate.chunkIndex,
            score: dotProduct(query, candidate.vector)
        };
        if (heap.length < topK) {
            heap.push(result);
            siftUp(heap, heap.length - 1);
        } else if (isBetterResult(result, heap[0])) {
            heap[0] = result;
            siftDown(heap, 0);
        }
    }
    heap.sort(compareDocumentSearchResults);
    return heap;
}

function siftUp(heap: DocumentSearchResult[], startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!isBetterResult(heap[parent], heap[index])) return;
        [heap[parent], heap[index]] = [heap[index], heap[parent]];
        index = parent;
    }
}

function siftDown(heap: DocumentSearchResult[], startIndex: number): void {
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

function isBetterResult(left: DocumentSearchResult, right: DocumentSearchResult): boolean {
    return (
        left.score > right.score ||
        (left.score === right.score &&
            (left.documentIndex < right.documentIndex ||
                (left.documentIndex === right.documentIndex && left.chunkIndex < right.chunkIndex)))
    );
}

function compareDocumentSearchResults(
    left: DocumentSearchResult,
    right: DocumentSearchResult
): number {
    return (
        right.score - left.score ||
        left.documentIndex - right.documentIndex ||
        left.chunkIndex - right.chunkIndex
    );
}
