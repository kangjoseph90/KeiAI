// ─── Handler (Protocol) ──────────────────────────────────────────────────────

export type EmbeddingHandler = 'openai_compatible' | 'google' | 'onnx';

// ─── Provider Types ─────────────────────────────────────────────────────────

export type RemoteEmbeddingProvider = 'openai' | 'google';
export type LocalEmbeddingProvider = 'minilm';
export type BuiltInEmbeddingProvider = RemoteEmbeddingProvider | LocalEmbeddingProvider;

export type CustomEmbeddingProvider = 'custom';
export type EmbeddingProvider = BuiltInEmbeddingProvider | CustomEmbeddingProvider;

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<EmbeddingProvider, string> = {
	openai: 'OpenAI',
	google: 'Google',
	minilm: 'MiniLM',
	custom: 'Custom'
};

const remoteProviderUrls: Record<RemoteEmbeddingProvider, string> = {
	openai: 'https://api.openai.com/v1',
	google: 'https://generativelanguage.googleapis.com/v1beta'
};

export function getEmbeddingProviderName(provider: EmbeddingProvider): string {
	return providerNames[provider] || provider;
}

export function getEmbeddingProviderUrl(provider: RemoteEmbeddingProvider): string {
	return remoteProviderUrls[provider] || provider;
}

export function isRemoteEmbeddingProvider(
	provider: EmbeddingProvider
): provider is RemoteEmbeddingProvider {
	return provider in remoteProviderUrls;
}

// ─── Model Definitions ─────────────────────────────────────────────────────

export interface EmbeddingModelBase {
	id: string;
	name: string;
	modelId: string;
	handler: EmbeddingHandler;
	dimensions?: number;
}

export interface BuiltInEmbeddingModel extends EmbeddingModelBase {
	provider: BuiltInEmbeddingProvider;
}

export interface CustomEmbeddingModel extends EmbeddingModelBase {
	provider: CustomEmbeddingProvider;
	baseUrl: string;
	apiKey?: string;
}

export type EmbeddingModel = BuiltInEmbeddingModel | CustomEmbeddingModel;

// ─── Runtime Config ─────────────────────────────────────────────────────────

export interface EmbeddingModelConfig {
	id: string;
	provider: EmbeddingProvider;
}

// ─── Built-in Model Registry ────────────────────────────────────────────────

const OPENAI_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	{
		id: 'openai::text-embedding-3-small',
		name: 'Embedding 3 Small',
		modelId: 'text-embedding-3-small',
		provider: 'openai',
		handler: 'openai_compatible',
		dimensions: 1536
	},
	{
		id: 'openai::text-embedding-3-large',
		name: 'Embedding 3 Large',
		modelId: 'text-embedding-3-large',
		provider: 'openai',
		handler: 'openai_compatible',
		dimensions: 3072
	}
];

const GOOGLE_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	{
		id: 'google::text-embedding-005',
		name: 'Text Embedding 005',
		modelId: 'text-embedding-005',
		provider: 'google',
		handler: 'google',
		dimensions: 768
	}
];

const MINILM_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [];

export const BUILT_IN_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	...OPENAI_EMBEDDING_MODELS,
	...GOOGLE_EMBEDDING_MODELS,
	...MINILM_EMBEDDING_MODELS
];
