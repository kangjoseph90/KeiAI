/**
 * Voyage AI Embedding Handler — KeiAI
 *
 * Supports both Voyage's regular text embedding endpoint and the
 * contextualized chunk endpoint used by voyage-context-* models.
 */

import { appHttp } from '$lib/adapters/http';
import { AppError } from '$lib/types/errors';
import { buildUrl } from '$lib/utils/url';
import { groupEmbeddingVectors } from '../grouping';
import type { DocumentEmbeddingResult, EmbeddingHandler, EmbeddingResult } from '../types';

export interface VoyageAIEmbeddingConfig {
    apiKey?: string;
    modelId: string;
    baseUrl: string;
    useProxy?: boolean;
}

export class VoyageAIEmbeddingHandler implements EmbeddingHandler {
    private readonly config: VoyageAIEmbeddingConfig;

    constructor(config: VoyageAIEmbeddingConfig) {
        this.config = config;
    }

    async embedQuery(queries: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
        signal?.throwIfAborted();
        if (queries.length === 0) return { vectors: [] };
        const vectors = await this.request(
            'query',
            queries.map((query) => [query]),
            signal
        );
        return { vectors: vectors.flat() };
    }

    async embedDocuments(
        documents: string[][],
        signal?: AbortSignal
    ): Promise<DocumentEmbeddingResult> {
        signal?.throwIfAborted();
        if (documents.length === 0) return { vectors: [] };
        return { vectors: await this.request('document', documents, signal) };
    }

    private async request(
        inputType: 'query' | 'document',
        inputs: string[][],
        signal?: AbortSignal
    ): Promise<Float32Array[][]> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers.Authorization = `Bearer ${this.config.apiKey}`;
        }

        const contextualized = this.isContextualizedModel();
        const endpoint = contextualized ? '/contextualizedembeddings' : '/embeddings';
        const response = await appHttp.fetch(
            buildUrl(this.config.baseUrl, endpoint),
            {
                method: 'POST',
                headers,
                body: JSON.stringify(
                    contextualized
                        ? { model: this.config.modelId, inputs, input_type: inputType }
                        : {
                              model: this.config.modelId,
                              input: inputs.flat(),
                              input_type: inputType
                          }
                ),
                signal
            },
            { proxy: this.config.useProxy ?? true, signal }
        );

        if (!response.ok) {
            throw new AppError('NETWORK_ERROR', `VoyageAI Embedding failed: ${response.status}`);
        }

        const json: unknown = await response.json();
        return contextualized
            ? this.parseContextualizedResponse(json, inputs)
            : this.parseStandardResponse(json, inputs);
    }

    private isContextualizedModel(): boolean {
        return this.config.modelId.startsWith('voyage-context-');
    }

    private parseStandardResponse(value: unknown, inputs: string[][]): Float32Array[][] {
        const expectedCount = inputs.flat().length;
        const ordered = orderIndexedItems(readArray(value, 'data'), expectedCount);
        const flatVectors = ordered.map((item) => readVector(item.embedding));
        return groupEmbeddingVectors(
            flatVectors,
            inputs.map((group) => group.length)
        );
    }

    private parseContextualizedResponse(value: unknown, inputs: string[][]): Float32Array[][] {
        const orderedGroups = orderIndexedItems(readArray(value, 'data'), inputs.length);

        const vectors: Float32Array[][] = [];
        for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
            const group = orderedGroups[groupIndex];
            const items = orderIndexedItems(readArray(group, 'data'), inputs[groupIndex].length);
            vectors.push(items.map((item) => readVector(item.embedding)));
        }
        return vectors;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readArray(value: unknown, key: string): unknown[] {
    if (!isRecord(value) || !Array.isArray(value[key])) {
        throw new AppError('NETWORK_ERROR', 'VoyageAI Embedding returned an invalid response');
    }
    return value[key];
}

function orderIndexedItems(items: unknown[], expectedCount: number): Record<string, unknown>[] {
    if (items.length !== expectedCount) {
        throw new AppError('NETWORK_ERROR', 'VoyageAI Embedding returned an invalid item count');
    }

    const ordered: Array<Record<string, unknown> | undefined> = new Array(expectedCount);
    for (const item of items) {
        if (!isRecord(item) || !Number.isInteger(item.index)) {
            throw new AppError('NETWORK_ERROR', 'VoyageAI Embedding returned an invalid response');
        }
        const index = item.index as number;
        if (index < 0 || index >= expectedCount || ordered[index]) {
            throw new AppError('NETWORK_ERROR', 'VoyageAI Embedding returned an invalid index');
        }
        ordered[index] = item;
    }
    return ordered as Record<string, unknown>[];
}

function readVector(value: unknown): Float32Array {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
        throw new AppError('NETWORK_ERROR', 'VoyageAI Embedding returned an invalid vector');
    }
    return Float32Array.from(value);
}
