/**
 * Embedding Provider Types — KeiAI
 *
 * Simple provider types for embedding. Model selection is handled in UI dropdowns
 * and stored directly in provider config (no model registry needed for built-ins).
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
