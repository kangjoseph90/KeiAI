/**
 * Handler Selection — KeiAI
 *
 * Resolves a LLMModelConfig + AppSettings into a concrete LLMStreamHandler.
 * Dispatches by **provider** (not handler), since each built-in provider
 * determines its own handler class. Custom models specify handler explicitly.
 */

import type { LLMStreamHandler } from '$lib/llm/types';
import { MockLLMStreamHandler, type MockBehavior } from '$lib/llm/handlers';
import { OpenAILLMStreamHandler } from '$lib/llm/handlers/openai';
import type { AppSettings } from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import {
	type LLMModelConfig,
	type LLMModel,
	type BuiltInLLMModel,
	type CustomLLMModel,
	BUILT_IN_LLM_MODELS
} from '$lib/types/models/llm';

const logger = createLogger('llm:handler');

/**
 * Build a LLMStreamHandler from the given model config + app settings.
 * Returns null when the model is not found or no API key is configured.
 */
export function selectLLMHandler(
	modelConfig: LLMModelConfig,
	settings: AppSettings
): LLMStreamHandler | null {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		logger.warn('Model not found.');
		return null;
	}

	// Custom models: dispatch by handler field
	if (model.provider === 'custom') {
		return selectCustomHandler(model, settings);
	}

	// Built-in models: dispatch by provider
	return selectBuiltInHandler(model, modelConfig, settings);
}

function selectBuiltInHandler(
	model: BuiltInLLMModel,
	modelConfig: LLMModelConfig,
	settings: AppSettings
): LLMStreamHandler | null {
	switch (model.provider) {
		case 'openai': {
			const apiKey = settings.providers.openai?.apiKey;
			if (!apiKey) {
				logger.warn('No OpenAI API key.');
				return null;
			}
			return new OpenAILLMStreamHandler({
				model: {
					modelId: model.modelId,
					flags: model.flags,
					parameters: modelConfig.parameters
				},
				http: {
					apiKey,
					baseUrl: 'https://api.openai.com/v1'
				}
			});
		}

		case 'anthropic': {
			const apiKey = settings.providers.anthropic?.apiKey;
			if (!apiKey) {
				logger.warn('No Anthropic API key.');
				return null;
			}
			// TODO: implement AnthropicLLMStreamHandler
			logger.warn('Anthropic LLM not yet implemented.');
			return null;
		}

		case 'deepseek': {
			const apiKey = settings.providers.deepseek?.apiKey;
			if (!apiKey) {
				logger.warn('No DeepSeek API key.');
				return null;
			}
			return new OpenAILLMStreamHandler({
				model: {
					modelId: model.modelId,
					flags: model.flags,
					parameters: modelConfig.parameters
				},
				http: {
					apiKey,
					baseUrl: 'https://api.deepseek.com'
				}
			});
		}

		case 'google': {
			const apiKey = settings.providers.google?.apiKey;
			if (!apiKey) {
				logger.warn('No Google API key.');
				return null;
			}
			// TODO: implement GoogleLLMStreamHandler
			logger.warn('Google LLM not yet implemented.');
			return null;
		}

		case 'mistral': {
			const apiKey = settings.providers.mistral?.apiKey;
			if (!apiKey) {
				logger.warn('No Mistral API key.');
				return null;
			}
			return new OpenAILLMStreamHandler({
				model: {
					modelId: model.modelId,
					flags: model.flags,
					parameters: modelConfig.parameters
				},
				http: {
					apiKey,
					baseUrl: 'https://api.mistral.ai/v1'
				}
			});
		}

		case 'webllm':
			// TODO: implement WebLLMHandler — no API key needed
			logger.warn('WebLLM not yet implemented.');
			return null;

		case 'mock':
			return new MockLLMStreamHandler({ behavior: model.modelId as MockBehavior });

		default:
			logger.warn(`Unknown provider: ${model.provider}`);
			return null;
	}
}

function selectCustomHandler(
	model: CustomLLMModel,
	_settings: AppSettings
): LLMStreamHandler | null {
	if (!model.apiKey) {
		logger.warn('No API key for custom model.');
		return null;
	}

	switch (model.handler) {
		case 'openai_compatible':
			return new OpenAILLMStreamHandler({
				model: {
					modelId: model.modelId,
					flags: model.flags,
					parameters: {}
				},
				http: {
					apiKey: model.apiKey,
					baseUrl: model.baseUrl
				}
			});

		case 'anthropic':
			logger.warn('Custom Anthropic handler not yet implemented.');
			return null;

		case 'google':
			logger.warn('Custom Google handler not yet implemented.');
			return null;

		case 'webllm':
			logger.warn('Custom WebLLM handler not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown custom handler: ${model.handler}`);
			return null;
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
