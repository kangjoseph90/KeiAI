/**
 * TTS Provider Types — KeiAI
 *
 * Simple provider enum for TTS. Model selection is handled in UI dropdowns
 * and stored directly in provider config (no model registry needed).
 */

export type BuiltInTTSProvider =
    | 'openai'
    | 'elevenlabs'
    | 'google'
    | 'novelai'
    | 'kokoro'
    | 'transformers'
    | 'mock';
export type TTSProvider = BuiltInTTSProvider | 'plugin';

export interface PluginTTSModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

export const KOKORO_VOICE_IDS = [
    'af_heart',
    'af_alloy',
    'af_aoede',
    'af_bella',
    'af_jessica',
    'af_kore',
    'af_nicole',
    'af_nova',
    'af_river',
    'af_sarah',
    'af_sky',
    'am_adam',
    'am_echo',
    'am_eric',
    'am_fenrir',
    'am_liam',
    'am_michael',
    'am_onyx',
    'am_puck',
    'am_santa',
    'bf_alice',
    'bf_emma',
    'bf_isabella',
    'bf_lily',
    'bm_daniel',
    'bm_fable',
    'bm_george',
    'bm_lewis'
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICE_IDS)[number];

export function isKokoroVoiceId(value: string): value is KokoroVoiceId {
    return KOKORO_VOICE_IDS.some((voiceId) => voiceId === value);
}

const providerNames: Record<TTSProvider, string> = {
    openai: 'OpenAI',
    elevenlabs: 'ElevenLabs',
    google: 'Google',
    novelai: 'NovelAI',
    kokoro: 'Kokoro',
    transformers: 'Transformers',
    mock: 'Mock',
    plugin: 'Plugin'
};

export function getTTSProviderName(provider: TTSProvider): string {
    return providerNames[provider];
}
