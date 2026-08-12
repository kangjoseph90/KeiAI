/**
 * TTS Provider Types — KeiAI
 *
 * Provider and recommended model ID definitions for text-to-speech.
 */

export type BuiltInTTSProvider =
    | 'openai'
    | 'openrouter'
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

export const TTS_MODEL_IDS: Partial<Record<BuiltInTTSProvider, readonly string[]>> = {
    openai: ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'tts-1-hd', 'tts-1'],
    openrouter: [],
    google: [
        'gemini-3.1-flash-tts-preview',
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-pro-preview-tts'
    ],
    elevenlabs: ['eleven_v3', 'eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_flash_v2'],
    transformers: [
        'Xenova/mms-tts-eng',
        'Xenova/mms-tts-kor',
        'Xenova/mms-tts-deu',
        'Xenova/mms-tts-spa'
    ],
    mock: ['sample', 'morse']
};

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
    openrouter: 'OpenRouter',
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
