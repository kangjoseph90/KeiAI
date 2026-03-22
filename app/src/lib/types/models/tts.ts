export type BuiltInTTSProvider = 'openai' | 'elevenlabs' | 'google';
export type LocalTTSProvider = 'kokoro';
export type TTSProvider = BuiltInTTSProvider | LocalTTSProvider;

const providerNames: Record<TTSProvider, string> = {
	openai: 'OpenAI',
	elevenlabs: 'ElevenLabs',
	google: 'Google',
	kokoro: 'Kokoro'
};

export function getTTSProviderName(provider: TTSProvider): string {
	return providerNames[provider] || provider;
}

export interface TTSModelConfig {
	provider: TTSProvider;
	voiceId: string;
}
