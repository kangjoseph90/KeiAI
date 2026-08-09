/**
 * Embedding Provider Types — KeiAI
 *
 * Provider and recommended model ID definitions for embeddings.
 */

export type BuiltInEmbeddingProvider =
    | 'openai'
    | 'google'
    | 'voyageai'
    | 'openrouter'
    | 'minilm'
    | 'transformers'
    | 'custom';
export type EmbeddingProvider = BuiltInEmbeddingProvider | 'plugin';

export interface PluginEmbeddingModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

export const EMBEDDING_MODEL_IDS: Partial<Record<BuiltInEmbeddingProvider, readonly string[]>> = {
    openai: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    google: ['gemini-embedding-2', 'gemini-embedding-001'],
    voyageai: ['voyage-4-large', 'voyage-4', 'voyage-4-lite', 'voyage-code-3'],
    openrouter: [
        'openai/text-embedding-3-small',
        'openai/text-embedding-3-large',
        'qwen/qwen3-embedding-8b',
        'google/gemini-embedding-001',
        'mistralai/mistral-embed-2312'
    ],
    minilm: ['onnx-community/all-MiniLM-L6-v2-ONNX', 'Xenova/all-MiniLM-L6-v2'],
    transformers: [
        'onnx-community/Qwen3-Embedding-0.6B-ONNX',
        'onnx-community/all-MiniLM-L6-v2-ONNX',
        'onnx-community/embeddinggemma-300m-ONNX',
        'Xenova/all-MiniLM-L6-v2'
    ]
};

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<EmbeddingProvider, string> = {
    openai: 'OpenAI',
    google: 'Google',
    voyageai: 'VoyageAI',
    openrouter: 'OpenRouter',
    minilm: 'MiniLM',
    transformers: 'Transformers',
    custom: 'Custom',
    plugin: 'Plugin'
};

export function getEmbeddingProviderName(provider: EmbeddingProvider): string {
    return providerNames[provider] || provider;
}
