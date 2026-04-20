/**
 * Reranker Provider Types — KeiAI
 *
 * Provider enum for reranking. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type RerankerProvider = 'cohere' | 'jina' | 'voyageai' | 'transformers';

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<RerankerProvider, string> = {
    cohere: 'Cohere',
    jina: 'Jina AI',
    voyageai: 'VoyageAI',
    transformers: 'Transformers'
};

export function getRerankerProviderName(provider: RerankerProvider): string {
    return providerNames[provider] || provider;
}
