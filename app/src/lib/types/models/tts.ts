/**
 * TTS Provider Types — KeiAI
 *
 * Simple provider enum for TTS. Model selection is handled in UI dropdowns
 * and stored directly in provider config (no model registry needed).
 */

export type TTSProvider =
    | 'openai'
    | 'elevenlabs'
    | 'google'
    | 'novelai'
    | 'kokoro'
    | 'transformers';

const providerNames: Record<TTSProvider, string> = {
    openai: 'OpenAI',
    elevenlabs: 'ElevenLabs',
    google: 'Google',
    novelai: 'NovelAI',
    kokoro: 'Kokoro',
    transformers: 'Transformers'
};

export function getTTSProviderName(provider: TTSProvider): string {
    return providerNames[provider] || provider;
}
