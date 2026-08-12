/**
 * Mock Embedding Handler — Development / Testing
 */

import type { DocumentEmbeddingResult, EmbeddingHandler, EmbeddingResult } from '../types';
import { groupEmbeddingVectors } from '../grouping';

const DIAGNOSTIC_DIMENSIONS = 32;

export type MockEmbeddingBehavior = 'sample' | 'diagnostic';

export interface MockEmbeddingConfig {
    behavior?: MockEmbeddingBehavior;
}

export class MockEmbeddingHandler implements EmbeddingHandler {
    private readonly behavior: MockEmbeddingBehavior;

    constructor(config: MockEmbeddingConfig = {}) {
        this.behavior = config.behavior ?? 'sample';
    }

    embedQuery(queries: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        return this.embed(queries, signal);
    }

    async embedDocuments(
        documents: string[][],
        signal?: AbortSignal
    ): Promise<DocumentEmbeddingResult> {
        const { vectors } = await this.embed(documents.flat(), signal);
        return {
            vectors: groupEmbeddingVectors(
                vectors,
                documents.map((document) => document.length)
            )
        };
    }

    private async embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        signal?.throwIfAborted();
        const vectors = texts.map((text) => {
            signal?.throwIfAborted();
            return this.behavior === 'sample'
                ? new Float32Array([1, 0, 0, 0])
                : createDiagnosticVector(text);
        });
        return { vectors };
    }
}

function createDiagnosticVector(text: string): Float32Array {
    const vector = new Float32Array(DIAGNOSTIC_DIMENSIONS);
    vector[0] = 1;
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? ['<empty>'];
    for (const token of tokens) {
        const hash = hashText(token);
        const index = 1 + (hash % (DIAGNOSTIC_DIMENSIONS - 1));
        const sign = (hash & 0x80000000) === 0 ? 1 : -1;
        vector[index] += sign;
    }
    return vector;
}

function hashText(text: string): number {
    let hash = 0x811c9dc5;
    for (const character of text) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
