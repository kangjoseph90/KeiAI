export type ProviderConfig = {
	openai?: OpenAIProviderConfig;
	anthropic?: AnthropicProviderConfig;
	google?: GoogleProviderConfig;
	mistral?: MistralProviderConfig;
	deepseek?: DeepSeekProviderConfig;
	webllm?: WebLLMProviderConfig;
	mock?: MockProviderConfig;
};

export type OpenAIProviderConfig = {
	apiKey: string;
	// voiceid - tts setting
	// verbocity - llm setting
};

export type AnthropicProviderConfig = {
	apiKey: string;
};

export type GoogleProviderConfig = {
	apiKey: string;
};

export type MistralProviderConfig = {
	apiKey: string;
};

export type DeepSeekProviderConfig = {
	apiKey: string;
};

export type WebLLMProviderConfig = {
	modelUrl: string;
};

export type MockProviderConfig = Record<string, never>;
