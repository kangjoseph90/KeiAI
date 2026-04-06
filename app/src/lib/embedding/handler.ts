/**
 * Embedding Handler Selection — KeiAI
 *
 * Resolves an EmbeddingModelConfig + AppSettings into a concrete EmbeddingHandler.
 * Dispatches by provider for built-in models, by handler for custom models.
 */

import type { EmbeddingHandler as EmbeddingHandlerType } from './types';
import type { AppSettings } from '$lib/services';
import { OpenAIEmbeddingHandler } from './handlers/openai';
import { createLogger } from '$lib/adapters/logger';
import {
	type EmbeddingModelConfig,
	type EmbeddingModel,
	type BuiltInEmbeddingModel,
	type CustomEmbeddingModel,
	BUILT_IN_EMBEDDING_MODELS
} from '$lib/types/models/embedding';

const logger = createLogger('embedding:handler');

export function selectEmbeddingHandler(
	modelConfig: EmbeddingModelConfig,
	settings: AppSettings
): EmbeddingHandlerType | null {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		logger.warn('Embedding model not found.');
		return null;
	}

	// Custom models: dispatch by handler field
	if (model.provider === 'custom') {
		return selectCustomHandler(model);
	}

	// Built-in models: dispatch by provider
	return selectBuiltInHandler(model, settings);
}

function selectBuiltInHandler(
	model: BuiltInEmbeddingModel,
	settings: AppSettings
): EmbeddingHandlerType | null {
	switch (model.provider) {
		case 'openai': {
			const apiKey = settings.providers.openai?.apiKey;
			if (!apiKey) {
				logger.warn('No OpenAI API key for embedding.');
				return null;
			}
			return new OpenAIEmbeddingHandler({
				apiKey,
				baseUrl: 'https://api.openai.com/v1',
				modelId: model.modelId
			});
		}

		case 'google': {
			const apiKey = settings.providers.google?.apiKey;
			if (!apiKey) {
				logger.warn('No Google API key for embedding.');
				return null;
			}
			// TODO: implement GoogleEmbeddingHandler
			logger.warn('Google Embedding not yet implemented.');
			return null;
		}

		case 'minilm':
			// TODO: implement MiniLMEmbeddingHandler — local, no API key needed
			logger.warn('MiniLM embedding not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown embedding provider: ${model.provider}`);
			return null;
	}
}

function selectCustomHandler(model: CustomEmbeddingModel): EmbeddingHandlerType | null {
	if (!model.apiKey) {
		logger.warn('No API key for custom embedding model.');
		return null;
	}

	switch (model.handler) {
		case 'openai_compatible':
			return new OpenAIEmbeddingHandler({
				apiKey: model.apiKey,
				baseUrl: model.baseUrl,
				modelId: model.modelId
			});

		case 'google':
			logger.warn('Custom Google embedding handler not yet implemented.');
			return null;

		case 'onnx':
			logger.warn('Custom ONNX embedding handler not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown custom embedding handler: ${model.handler}`);
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
