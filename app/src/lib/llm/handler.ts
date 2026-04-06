/**
 * Handler Selection — KeiAI
 *
 * Resolves a LLMModelConfig + AppSettings into a concrete LLMStreamHandler.
 * Handles both built-in models (provider → settings.apiKeys) and
 * custom models (model.baseUrl + model.apiKey).
 */

import type { LLMStreamHandler } from '$lib/llm/types';
import { MockLLMStreamHandler } from '$lib/llm/handlers';
import { OpenAILLMStreamHandler } from '$lib/llm/handlers/openai';
import type { AppSettings } from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import {
	type LLMModelConfig,
	type LLMModel,
	type RemoteLLMProvider,
	BUILT_IN_LLM_MODELS,
	getLLMProviderUrl,
	isRemoteLLMProvider
} from '$lib/types/models/llm';

const logger = createLogger('llm:handler');

/**
 * Build a LLMStreamHandler from the given model config + app settings.
 * Falls back to MockLLMStreamHandler when the model is not found or no API key.
 */
export function selectLLMHandler(
	modelConfig: LLMModelConfig,
	settings: AppSettings
): LLMStreamHandler {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		logger.warn('Model not found. Falling back to MockLLMStreamHandler.');
		return new MockLLMStreamHandler();
	}

	const connection = resolveConnection(model, settings);

	if (!connection.apiKey) {
		logger.warn('No API key found. Falling back to MockLLMStreamHandler.');
		return new MockLLMStreamHandler();
	}

	switch (model.handler) {
		case 'openai_compatible':
			return new OpenAILLMStreamHandler({
				model: {
					modelId: model.modelId,
					flags: model.flags,
					parameters: modelConfig.parameters
				},
				http: {
					apiKey: connection.apiKey,
					baseUrl: connection.baseUrl
				}
			});
		case 'anthropic':
			// TODO: implement AnthropicLLMStreamHandler
			logger.warn('Anthropic LLM not yet implemented.');
			return new MockLLMStreamHandler();
		case 'google':
			// TODO: implement GoogleLLMStreamHandler
			logger.warn('Google LLM not yet implemented.');
			return new MockLLMStreamHandler();
		default:
			logger.warn(`Unknown LLM handler: ${model.handler}`);
			return new MockLLMStreamHandler();
	}
}

/**
 * Look up the full LLMModel definition from a LLMModelConfig reference.
 */
function resolveModel(config: LLMModelConfig, settings: AppSettings): LLMModel | undefined {
	if (config.provider === 'custom') {
		return settings.customModels?.find((m) => m.id === config.id);
	}
	return BUILT_IN_LLM_MODELS.find((m) => m.id === config.id);
}

/**
 * Resolve connection details (baseUrl + apiKey) for a model.
 * Built-in: uses provider defaults + settings.apiKeys.
 * Custom: uses model's own baseUrl + apiKey.
 */
function resolveConnection(
	model: LLMModel,
	settings: AppSettings
): { baseUrl: string; apiKey: string | undefined } {
	if (model.provider === 'custom') {
		return { baseUrl: model.baseUrl, apiKey: model.apiKey };
	}

	if (isRemoteLLMProvider(model.provider)) {
		return {
			baseUrl: getLLMProviderUrl(model.provider),
			apiKey: settings.apiKeys[model.provider]
		};
	}

	// Local provider (e.g. webllm)
	return {
		baseUrl: '',
		apiKey: 'local'
	};
}
