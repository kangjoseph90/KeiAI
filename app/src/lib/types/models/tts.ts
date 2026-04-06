// ─── Handler (Protocol / Runtime) ────────────────────────────────────────────

export type TTSHandler =
	| 'openai' // OpenAI /audio/speech
	| 'elevenlabs' // ElevenLabs /text-to-speech
	| 'google' // Google Cloud TTS
	| 'onnx';

// ─── Provider Types ─────────────────────────────────────────────────────────

export type BuiltInTTSProvider = 'openai' | 'elevenlabs' | 'google' | 'kokoro';

export type CustomTTSProvider = 'custom';
export type TTSProvider = BuiltInTTSProvider | CustomTTSProvider;

// ─── Display Helpers ────────────────────────────────────────────────────────

const handlerNames: Record<TTSHandler, string> = {
	openai: 'OpenAI Audio',
	elevenlabs: 'ElevenLabs',
	google: 'Google Cloud TTS',
	onnx: 'ONNX'
};

const providerNames: Record<TTSProvider, string> = {
	openai: 'OpenAI',
	elevenlabs: 'ElevenLabs',
	google: 'Google',
	kokoro: 'Kokoro',
	custom: 'Custom'
};

export function getTTSHandlerName(handler: TTSHandler): string {
	return handlerNames[handler] || handler;
}

export function getTTSProviderName(provider: TTSProvider): string {
	return providerNames[provider] || provider;
}

// ─── Model Definitions ─────────────────────────────────────────────────────
//
// Unlike LLM (shared parameters across formats), TTS parameters are
// handler-specific and too divergent for a common enum.
// Parameters live in the provider config (constructor), not here.

export interface TTSModelBase {
	id: string;
	name: string;
	modelId: string;
}

export interface BuiltInTTSModel extends TTSModelBase {
	provider: BuiltInTTSProvider;
}

export interface CustomTTSModel extends TTSModelBase {
	provider: CustomTTSProvider;
	handler: TTSHandler;
	baseUrl: string;
	apiKey?: string;
}

export type TTSModel = BuiltInTTSModel | CustomTTSModel;

// ─── Built-in Model Registry ────────────────────────────────────────────────

const OPENAI_TTS_MODELS: BuiltInTTSModel[] = [
	{
		id: 'openai::tts-1',
		name: 'TTS-1',
		modelId: 'tts-1',
		provider: 'openai'
	},
	{
		id: 'openai::tts-1-hd',
		name: 'TTS-1 HD',
		modelId: 'tts-1-hd',
		provider: 'openai'
	}
];

const ELEVENLABS_TTS_MODELS: BuiltInTTSModel[] = [];

const GOOGLE_TTS_MODELS: BuiltInTTSModel[] = [];

const KOKORO_TTS_MODELS: BuiltInTTSModel[] = [];

export const BUILT_IN_TTS_MODELS: BuiltInTTSModel[] = [
	...OPENAI_TTS_MODELS,
	...ELEVENLABS_TTS_MODELS,
	...GOOGLE_TTS_MODELS,
	...KOKORO_TTS_MODELS
];
