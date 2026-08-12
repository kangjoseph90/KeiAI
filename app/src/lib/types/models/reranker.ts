/**
 * Reranker Provider Types — KeiAI
 *
 * Provider and recommended model ID definitions for reranking.
 */

export type BuiltInRerankerProvider =
    | 'cohere'
    | 'jina'
    | 'voyageai'
    | 'openrouter'
    | 'transformers'
    | 'mock';
export type RerankerProvider = BuiltInRerankerProvider | 'plugin';

export interface PluginRerankerModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

export const RERANKER_MODEL_IDS: Partial<Record<BuiltInRerankerProvider, readonly string[]>> = {
    cohere: [
        'rerank-v4.0-pro',
        'rerank-v4.0-fast',
        'rerank-v3.5',
        'rerank-multilingual-v3.0',
        'rerank-english-v3.0'
    ],
    jina: [
        'jina-reranker-v3',
        'jina-reranker-m0',
        'jina-reranker-v2-base-multilingual',
        'jina-colbert-v2'
    ],
    voyageai: ['rerank-2.5', 'rerank-2.5-lite', 'rerank-2', 'rerank-2-lite'],
    openrouter: [],
    transformers: ['Xenova/bge-reranker-base', 'onnx-community/bge-reranker-base-ONNX'],
    mock: ['sample', 'diagnostic']
};

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<RerankerProvider, string> = {
    cohere: 'Cohere',
    jina: 'Jina AI',
    voyageai: 'VoyageAI',
    openrouter: 'OpenRouter',
    transformers: 'Transformers',
    mock: 'Mock',
    plugin: 'Plugin'
};

export function getRerankerProviderName(provider: RerankerProvider): string {
    return providerNames[provider] || provider;
}
