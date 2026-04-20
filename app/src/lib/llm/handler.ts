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
import type { AppSettings } from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import {
    type LLMModelConfig,
    type LLMModel,
    type BuiltInLLMModel,
    type CustomLLMModel,
    BUILT_IN_LLM_MODELS,
    type LLMParameter
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
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1'
            });
        }

        case 'anthropic': {
            return new AnthropicLLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.anthropic.apiKey,
                baseUrl: 'https://api.anthropic.com/v1'
            });
        }

        case 'deepseek': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.deepseek.apiKey,
                baseUrl: 'https://api.deepseek.com'
            });
        }

        case 'google': {
            return new GoogleLLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.google.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
            });
        }

        case 'mistral': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.mistral.apiKey,
                baseUrl: 'https://api.mistral.ai/v1'
            });
        }

        case 'openrouter': {
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters,
                apiKey: settings.openrouter.apiKey,
                baseUrl: 'https://openrouter.ai/api/v1'
            });
        }

        case 'transformers': {
            return new TransformersLLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                parameters: modelConfig.parameters
            });
        }

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
    switch (model.handler) {
        case 'openai_compatible':
            return new OpenAILLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                apiKey: model.apiKey,
                baseUrl: model.baseUrl
            });

        case 'anthropic':
            return new AnthropicLLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
                apiKey: model.apiKey,
                baseUrl: model.baseUrl
            });

        case 'google':
            return new GoogleLLMStreamHandler({
                modelId: model.modelId,
                flags: model.flags,
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
        return settings.custom.llm.models?.find((m: CustomLLMModel) => m.id === config.id);
    }

    // Dynamic models
    if (config.provider === 'openrouter' || config.provider === 'transformers') {
        return {
            id: `${config.provider}::${config.id}`,
            name: config.id,
            modelId: config.id,
            provider: config.provider,
            tokenizer: config.tokenizer ?? 'o200k_base',
            flags: [],
            parameters: Object.keys(config.parameters) as LLMParameter[]
        } as BuiltInLLMModel;
    }

    // Static models
    return BUILT_IN_LLM_MODELS.find((m) => m.id === config.id);
}
