/**
 * STT Provider Types — KeiAI
 *
 * Provider and recommended model ID definitions for speech-to-text.
 */

export type BuiltInSTTProvider =
    | 'openai'
    | 'openrouter'
    | 'google'
    | 'groq'
    | 'transformers'
    | 'mock';
export type STTProvider = BuiltInSTTProvider | 'plugin';

export interface PluginSTTModel {
    id: string;
    name: string;
    modelId: string;
    provider: 'plugin';
}

export const STT_MODEL_IDS: Partial<Record<BuiltInSTTProvider, readonly string[]>> = {
    openai: [
        'gpt-transcribe',
        'gpt-4o-transcribe',
        'gpt-4o-transcribe-diarize',
        'gpt-4o-mini-transcribe',
        'whisper-1'
    ],
    openrouter: [],
    google: ['latest_long', 'latest_short', 'telephony', 'telephony_short'],
    groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    transformers: [
        'onnx-community/whisper-tiny',
        'onnx-community/whisper-small',
        'onnx-community/moonshine-tiny-ONNX',
        'onnx-community/moonshine-tiny-ko-ONNX'
    ],
    mock: ['sample', 'diagnostic']
};

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<STTProvider, string> = {
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    google: 'Google',
    groq: 'Groq',
    transformers: 'Transformers',
    mock: 'Mock',
    plugin: 'Plugin'
};

export function getSTTProviderName(provider: STTProvider): string {
    return providerNames[provider];
}
