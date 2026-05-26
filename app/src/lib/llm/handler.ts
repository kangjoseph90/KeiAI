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
import { TransformersLLMStreamHandler } from '$lib/llm/handlers/transformers';
import { AnthropicLLMStreamHandler } from '$lib/llm/handlers/anthropic';
import { GoogleLLMStreamHandler } from '$lib/llm/handlers/google';
import { PluginLLMStreamHandler } from '$lib/llm/handlers/plugin';
import type { AppSettings } from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import {
    type LLMModelConfig,
    type LLMModel,
    type BuiltInLLMModel,
    type CustomLLMModel,
    type PluginLLMModel,
    BUILT_IN_LLM_MODELS,
    type LLMType,
    type LLMParameters
} from '$lib/types/models/llm';
import { pluginManager } from '$lib/plugins';
import type { Preset } from '$lib/services';

const logger = createLogger('llm:handler');

/**
 * Resolves llm model and parameters by LLM type
 */
export function resolveLLMModelConfig(type: LLMType, preset: Preset): LLMModelConfig | null {
    const modelConfig = preset.models[type];
    if (modelConfig) return modelConfig;
    if (type === 'chat') return null;
    if (type === 'aux') return preset.models.chat ?? null;
    return preset.models.aux ?? preset.models.chat ?? null;
}

export function resolveLLMParameters(type: LLMType, preset: Preset): LLMParameters | null {
    const parameters = preset.parameters[type];
    if (parameters) return parameters;
    if (type === 'chat') return null;
    return preset.parameters.chat ?? null;
}

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
        return selectCustomHandler(model);
    }

    // Plugin models: dispatch by plugin handler
    if (model.provider === 'plugin') {
        return selectPluginHandler(model);
    }

    // Built-in models: dispatch by provider
    return selectBuiltInHandler(model, settings);
}

function selectPluginHandler(model: PluginLLMModel): LLMStreamHandler | null {
    for (const instance of pluginManager.getInstances()) {
        const providerDef = instance.llmProviders.get(model.modelId);
        if (providerDef) {
            return new PluginLLMStreamHandler(
                {
                    modelId: model.modelId
                },
                instance,
                providerDef.fnId
            );
        }
    }
    return null;
}

function selectBuiltInHandler(
    model: BuiltInLLMModel,
    settings: AppSettings
): LLMStreamHandler | null {
    switch (model.provider) {
        case 'openai': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1'
            });
        }

        case 'anthropic': {
            return new AnthropicLLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.anthropic.apiKey,
                baseUrl: 'https://api.anthropic.com/v1'
            });
        }

        case 'deepseek': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.deepseek.apiKey,
                baseUrl: 'https://api.deepseek.com'
            });
        }

        case 'google': {
            return new GoogleLLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.google.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
            });
        }

        case 'mistral': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.mistral.apiKey,
                baseUrl: 'https://api.mistral.ai/v1'
            });
        }

        case 'openrouter': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                apiKey: settings.openrouter.apiKey,
                baseUrl: 'https://openrouter.ai/api/v1'
            });
        }

        case 'transformers': {
            return new TransformersLLMStreamHandler({
                modelId: model.modelId
            });
        }

        case 'mock':
            return new MockLLMStreamHandler({ behavior: model.modelId as MockBehavior });

        default:
            logger.warn(`Unknown provider: ${model.provider}`);
            return null;
    }
}

function selectCustomHandler(model: CustomLLMModel): LLMStreamHandler | null {
    switch (model.handler) {
        case 'openai_compatible':
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                apiKey: model.apiKey,
                baseUrl: model.baseUrl
            });

        case 'anthropic':
            return new AnthropicLLMStreamHandler({
                modelId: model.modelId,
                apiKey: model.apiKey,
                baseUrl: model.baseUrl
            });

        case 'google':
            return new GoogleLLMStreamHandler({
                modelId: model.modelId,
                apiKey: model.apiKey,
                baseUrl: model.baseUrl
            });

        default:
            logger.warn(`Unknown custom handler: ${model.handler}`);
            return null;
    }
}

/**
 * Look up the full LLMModel definition from a LLMModelConfig reference.
 */
function resolveModel(config: LLMModelConfig, settings: AppSettings): LLMModel | undefined {
    // Custom models
    if (config.provider === 'custom') {
        return settings.custom.llm.models[config.id];
    }

    // Plugin models
    if (config.provider === 'plugin') {
        return pluginManager
            .getInstances()
            .flatMap((instance) => [...instance.llmProviders.values()].map((p) => p.model))
            .find((m) => m.id === config.id);
    }

    // Dynamic models
    if (config.provider === 'openrouter' || config.provider === 'transformers') {
        return {
            id: `${config.provider}::${config.id}`,
            name: config.id,
            modelId: config.id,
            provider: config.provider,
            tokenizer: config.tokenizer ?? 'o200k_base'
        } as BuiltInLLMModel;
    }

    // Static models
    return BUILT_IN_LLM_MODELS.find((m) => m.id === config.id);
}
