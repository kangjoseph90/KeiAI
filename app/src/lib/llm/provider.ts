/**
 * Provider Selection — KeiAI
 *
 * Resolves a ModelConfig + AppSettings into a concrete StreamProvider.
 * Handles both built-in models (provider → settings.apiKeys) and
 * custom models (model.baseUrl + model.apiKey).
 */

import type { StreamProvider } from '$lib/llm/types';
import { MockStreamProvider } from '$lib/llm/providers';
import { OpenAIStreamProvider } from '$lib/llm/providers/openai';
import type { AppSettings } from '$lib/services';
import {
	type ModelConfig,
	type LLMModel,
	type BuiltInProvider,
	BUILT_IN_MODELS,
	getProviderUrl
} from '$lib/types/models';

/**
 * Build a StreamProvider from the given model config + app settings.
 * Falls back to MockStreamProvider when the model is not found or no API key.
 */
export function selectProvider(modelConfig: ModelConfig, settings: AppSettings): StreamProvider {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		console.warn('[selectProvider] Model not found. Falling back to MockStreamProvider.');
		return new MockStreamProvider();
	}

	const connection = resolveConnection(model, settings);

	if (!connection.apiKey) {
		console.warn('[selectProvider] No API key found. Falling back to MockStreamProvider.');
		return new MockStreamProvider();
	}

	// TODO: apply retry and debounce parameters from AppSettings
	return new OpenAIStreamProvider({
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
}

/**
 * Look up the full LLMModel definition from a ModelConfig reference.
 */
function resolveModel(config: ModelConfig, settings: AppSettings): LLMModel | undefined {
	if (config.provider === 'custom') {
		return settings.customModels?.find((m) => m.id === config.id);
	}
	return BUILT_IN_MODELS.find((m) => m.id === config.id);
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

	const provider = model.provider as BuiltInProvider;
	return {
		baseUrl: getProviderUrl(provider),
		apiKey: settings.apiKeys[provider]
	};
}
