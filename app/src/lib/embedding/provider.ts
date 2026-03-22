/**
 * Embedding Provider Selection — KeiAI
 *
 * Resolves an EmbeddingModelConfig + AppSettings into a concrete EmbeddingStreamProvider.
 * Mirrors LLM's selectLLMProvider pattern: resolveModel → resolveConnection → class by format.
 */

import type { EmbeddingStreamProvider } from './types';
import type { AppSettings } from '$lib/services';
import { OpenAIEmbeddingProvider } from './providers/openai';
import { createLogger } from '$lib/adapters/logger';
import {
	type EmbeddingModelConfig,
	type EmbeddingModel,
	type BuiltInEmbeddingProvider,
	BUILT_IN_EMBEDDING_MODELS,
	getEmbeddingProviderUrl
} from '$lib/types/models/embedding';

const logger = createLogger('embedding:provider');

export function selectEmbeddingProvider(
	modelConfig: EmbeddingModelConfig,
	settings: AppSettings
): EmbeddingStreamProvider | null {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		logger.warn('Embedding model not found.');
		return null;
	}

	const connection = resolveConnection(model, settings);

	if (!connection.apiKey) {
		logger.warn('No API key found for embedding.');
		return null;
	}

	switch (model.format) {
		case 'openai_compatible':
			return new OpenAIEmbeddingProvider({
				apiKey: connection.apiKey,
				baseUrl: connection.baseUrl,
				modelId: model.modelId
			});

		case 'google':
			// TODO: implement GoogleEmbeddingProvider
			logger.warn('Google Embedding not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown embedding format: ${model.format}`);
			return null;
	}
}

function resolveModel(
	config: EmbeddingModelConfig,
	settings: AppSettings
): EmbeddingModel | undefined {
	if (config.provider === 'custom') {
		// TODO: settings.customEmbeddingModels
		return undefined;
	}
	return BUILT_IN_EMBEDDING_MODELS.find((m) => m.id === config.id);
}

function resolveConnection(
	model: EmbeddingModel,
	settings: AppSettings
): { baseUrl: string; apiKey: string | undefined } {
	if (model.provider === 'custom') {
		return { baseUrl: model.baseUrl, apiKey: model.apiKey };
	}

	const provider = model.provider as BuiltInEmbeddingProvider;
	return {
		baseUrl: getEmbeddingProviderUrl(provider),
		apiKey: settings.apiKeys[provider]
	};
}
