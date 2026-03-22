// ─── Format (Protocol) ──────────────────────────────────────────────────────

export type EmbeddingFormat = 'openai_compatible' | 'google';

// ─── Provider Types ─────────────────────────────────────────────────────────

export type BuiltInEmbeddingProvider = 'openai' | 'google';
export type CustomEmbeddingProvider = 'custom';
// TODO: export type LocalEmbeddingProvider = 'onnx' | 'transformers';
export type EmbeddingProvider = BuiltInEmbeddingProvider | CustomEmbeddingProvider;

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<EmbeddingProvider, string> = {
	openai: 'OpenAI',
	google: 'Google',
	custom: 'Custom'
};

const builtInProviderUrls: Record<BuiltInEmbeddingProvider, string> = {
	openai: 'https://api.openai.com/v1',
	google: 'https://generativelanguage.googleapis.com/v1beta'
};

export function getEmbeddingProviderName(provider: EmbeddingProvider): string {
	return providerNames[provider] || provider;
}

export function getEmbeddingProviderUrl(provider: BuiltInEmbeddingProvider): string {
	return builtInProviderUrls[provider] || provider;
}

// ─── Model Definitions ─────────────────────────────────────────────────────

export interface EmbeddingModelBase {
	id: string;
	name: string;
	modelId: string;
	format: EmbeddingFormat;
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
		format: 'openai_compatible',
		dimensions: 1536
	},
	{
		id: 'openai::text-embedding-3-large',
		name: 'Embedding 3 Large',
		modelId: 'text-embedding-3-large',
		provider: 'openai',
		format: 'openai_compatible',
		dimensions: 3072
	}
];

const GOOGLE_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	{
		id: 'google::text-embedding-005',
		name: 'Text Embedding 005',
		modelId: 'text-embedding-005',
		provider: 'google',
		format: 'google',
		dimensions: 768
	}
];

export const BUILT_IN_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	...OPENAI_EMBEDDING_MODELS,
	...GOOGLE_EMBEDDING_MODELS
];
