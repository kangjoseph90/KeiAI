/**
 * ImageGen Provider Types — KeiAI
 *
 * Provider enum for image generation. Model selection is stored directly
 * in provider config (no model registry needed for built-ins).
 */

export type BuiltInImageGenProvider =
    | 'openai'
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

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<ImageGenProvider, string> = {
    openai: 'OpenAI',
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
