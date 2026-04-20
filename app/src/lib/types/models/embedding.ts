/**
 * Embedding Provider Types — KeiAI
 *
 * Simple provider types for embedding. Model selection is handled in UI dropdowns
 * and stored directly in provider config (no model registry needed for built-ins).
 */

export type EmbeddingProvider =
    | 'openai'
    | 'google'
    | 'voyageai'
    | 'openrouter'
    | 'minilm'
    | 'transformers'
    | 'custom';

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<EmbeddingProvider, string> = {
    openai: 'OpenAI',
    google: 'Google',
    voyageai: 'VoyageAI',
    openrouter: 'OpenRouter',
    minilm: 'MiniLM',
    transformers: 'Transformers',
    custom: 'Custom'
};

export function getEmbeddingProviderName(provider: EmbeddingProvider): string {
    return providerNames[provider] || provider;
}
