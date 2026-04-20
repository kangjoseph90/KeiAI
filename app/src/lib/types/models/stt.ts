/**
 * STT Provider Types — KeiAI
 *
 * Provider enum for speech-to-text. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type STTProvider = 'openai' | 'google' | 'groq' | 'transformers';

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<STTProvider, string> = {
    openai: 'OpenAI',
    google: 'Google',
    groq: 'Groq',
    transformers: 'Transformers'
};

export function getSTTProviderName(provider: STTProvider): string {
    return providerNames[provider] || provider;
}
