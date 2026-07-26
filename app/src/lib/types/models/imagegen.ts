/**
 * ImageGen Provider Types — KeiAI
 *
 * Provider enum for image generation. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type ImageGenProvider = 'openai' | 'stability' | 'google' | 'novelai' | 'comfyui';

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<ImageGenProvider, string> = {
    openai: 'OpenAI',
    stability: 'Stability AI',
    google: 'Google',
    novelai: 'NovelAI',
    comfyui: 'ComfyUI'
};

export function getImageGenProviderName(provider: ImageGenProvider): string {
    return providerNames[provider] || provider;
}
