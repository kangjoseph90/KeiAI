/**
 * STT Provider Types — KeiAI
 *
 * Provider enum for speech-to-text. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type BuiltInSTTProvider = 'openai' | 'google' | 'groq' | 'transformers' | 'mock';
export type STTProvider = BuiltInSTTProvider | 'plugin';

export interface PluginSTTModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<STTProvider, string> = {
    openai: 'OpenAI',
    google: 'Google',
    groq: 'Groq',
    transformers: 'Transformers',
    mock: 'Mock',
    plugin: 'Plugin'
};

export function getSTTProviderName(provider: STTProvider): string {
    return providerNames[provider];
}
