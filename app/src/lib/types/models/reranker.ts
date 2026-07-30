/**
 * Reranker Provider Types — KeiAI
 *
 * Provider enum for reranking. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type BuiltInRerankerProvider = 'cohere' | 'jina' | 'voyageai' | 'transformers';
export type RerankerProvider = BuiltInRerankerProvider | 'plugin';

export interface PluginRerankerModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<RerankerProvider, string> = {
    cohere: 'Cohere',
    jina: 'Jina AI',
    voyageai: 'VoyageAI',
    transformers: 'Transformers',
    plugin: 'Plugin'
};

export function getRerankerProviderName(provider: RerankerProvider): string {
    return providerNames[provider] || provider;
}
