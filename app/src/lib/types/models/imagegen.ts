/**
 * ImageGen Provider Types — KeiAI
 *
 * Provider and recommended model ID definitions for image generation.
 */

export type BuiltInImageGenProvider =
    | 'openai'
    | 'openrouter'
    | 'stability'
    | 'google'
    | 'novelai'
    | 'comfyui'
    | 'mock';
export type ImageGenProvider = BuiltInImageGenProvider | 'plugin';

export interface PluginImageGenModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

export const IMAGEGEN_MODEL_IDS: Partial<Record<BuiltInImageGenProvider, readonly string[]>> = {
    openai: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'],
    openrouter: [],
    google: ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image'],
    stability: ['ultra', 'core', 'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium', 'sd3.5-flash'],
    novelai: [
        'nai-diffusion-4-5-full',
        'nai-diffusion-4-5-curated',
        'nai-diffusion-4-full',
        'nai-diffusion-4-curated-preview'
    ],
    mock: ['sample', 'diagnostic']
};

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<ImageGenProvider, string> = {
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    stability: 'Stability AI',
    google: 'Google',
    novelai: 'NovelAI',
    comfyui: 'ComfyUI',
    mock: 'Mock',
    plugin: 'Plugin'
};

export function getImageGenProviderName(provider: ImageGenProvider): string {
    return providerNames[provider];
}
