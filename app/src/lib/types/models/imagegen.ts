/**
 * ImageGen Provider Types — KeiAI
 *
 * Provider enum for image generation. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type ImageGenProvider = 'openai' | 'stability' | 'google';

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<ImageGenProvider, string> = {
    openai: 'OpenAI',
    stability: 'Stability AI',
    google: 'Google'
};

export function getImageGenProviderName(provider: ImageGenProvider): string {
    return providerNames[provider] || provider;
}
