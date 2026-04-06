/**
 * Embedding Handler Selection — KeiAI
 *
 * Resolves an EmbeddingModelConfig + AppSettings into a concrete EmbeddingHandler.
 * Mirrors LLM's selectLLMHandler pattern: resolveModel → resolveConnection → class by handler.
 */

import type { EmbeddingHandler } from './types';
import type { AppSettings } from '$lib/services';
import { OpenAIEmbeddingHandler } from './handlers/openai';
import { createLogger } from '$lib/adapters/logger';
import {
	type EmbeddingModelConfig,
	type EmbeddingModel,
	type RemoteEmbeddingProvider,
	BUILT_IN_EMBEDDING_MODELS,
	getEmbeddingProviderUrl,
	isRemoteEmbeddingProvider
} from '$lib/types/models/embedding';

const logger = createLogger('embedding:handler');

export function selectEmbeddingHandler(
	modelConfig: EmbeddingModelConfig,
	settings: AppSettings
): EmbeddingHandler | null {
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

	switch (model.handler) {
		case 'openai_compatible':
			return new OpenAIEmbeddingHandler({
				apiKey: connection.apiKey,
				baseUrl: connection.baseUrl,
				modelId: model.modelId
			});

		case 'google':
			// TODO: implement GoogleEmbeddingHandler
			logger.warn('Google Embedding not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown embedding handler: ${model.handler}`);
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

	if (isRemoteEmbeddingProvider(model.provider)) {
		return {
			baseUrl: getEmbeddingProviderUrl(model.provider),
			apiKey: settings.apiKeys[model.provider]
		};
	}

	// Local provider (e.g. minilm)
	return {
		baseUrl: '',
		apiKey: 'local'
	};
}
