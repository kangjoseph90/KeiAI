// ─── Handler (Protocol) ──────────────────────────────────────────────────────

export type EmbeddingHandler = 'openai_compatible' | 'google' | 'onnx';

// ─── Provider Types ─────────────────────────────────────────────────────────

export type BuiltInEmbeddingProvider = 'openai' | 'google' | 'minilm';

export type CustomEmbeddingProvider = 'custom';
export type EmbeddingProvider = BuiltInEmbeddingProvider | CustomEmbeddingProvider;

// ─── Display Helpers ────────────────────────────────────────────────────────

const providerNames: Record<EmbeddingProvider, string> = {
	openai: 'OpenAI',
	google: 'Google',
	minilm: 'MiniLM',
	custom: 'Custom'
};

export function getEmbeddingProviderName(provider: EmbeddingProvider): string {
	return providerNames[provider] || provider;
}

// ─── Model Definitions ─────────────────────────────────────────────────────

export interface EmbeddingModelBase {
	id: string;
	name: string;
	modelId: string;
	dimensions?: number;
}

export interface BuiltInEmbeddingModel extends EmbeddingModelBase {
	provider: BuiltInEmbeddingProvider;
}

export interface CustomEmbeddingModel extends EmbeddingModelBase {
	provider: CustomEmbeddingProvider;
	handler: EmbeddingHandler;
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
		dimensions: 1536
	},
	{
		id: 'openai::text-embedding-3-large',
		name: 'Embedding 3 Large',
		modelId: 'text-embedding-3-large',
		provider: 'openai',
		dimensions: 3072
	}
];

const GOOGLE_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	{
		id: 'google::text-embedding-005',
		name: 'Text Embedding 005',
		modelId: 'text-embedding-005',
		provider: 'google',
		dimensions: 768
	}
];

const MINILM_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [];

export const BUILT_IN_EMBEDDING_MODELS: BuiltInEmbeddingModel[] = [
	...OPENAI_EMBEDDING_MODELS,
	...GOOGLE_EMBEDDING_MODELS,
	...MINILM_EMBEDDING_MODELS
];
