/**
 * Embedding Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete EmbeddingHandler.
 * Model ID is stored directly in provider config (no registry lookup for built-ins).
 */

import type { SelectedEmbeddingHandler } from './types';
import type { AppSettings } from '$lib/services';
import type { EmbeddingProvider } from '$lib/types/models/embedding';
import { OpenAIEmbeddingHandler } from './handlers/openai';
import { GoogleEmbeddingHandler } from './handlers/google';
import { TransformersEmbeddingHandler } from './handlers/transformers';
import { PluginEmbeddingHandler } from './handlers/plugin';
import { createLogger } from '$lib/adapters/logger';
import { pluginManager } from '$lib/plugins';

const logger = createLogger('embedding:handler');

export function selectEmbeddingHandler(
    provider: EmbeddingProvider,
    settings: AppSettings
): SelectedEmbeddingHandler | null {
    switch (provider) {
        case 'openai': {
            const modelId = settings.openai.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new OpenAIEmbeddingHandler({
                    apiKey: settings.openai.apiKey,
                    baseUrl: 'https://api.openai.com/v1',
                    modelId
                })
            };
        }

        case 'google': {
            const modelId = settings.google.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new GoogleEmbeddingHandler({
                    apiKey: settings.google.apiKey,
                    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                    modelId
                })
            };
        }

        case 'voyageai': {
            const modelId = settings.voyageai.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new OpenAIEmbeddingHandler({
                    apiKey: settings.voyageai.apiKey,
                    baseUrl: 'https://api.voyageai.com/v1',
                    modelId
                })
            };
        }

        case 'openrouter': {
            const modelId = settings.openrouter.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new OpenAIEmbeddingHandler({
                    apiKey: settings.openrouter.apiKey,
                    baseUrl: 'https://openrouter.ai/api/v1',
                    modelId
                })
            };
        }

        case 'minilm': {
            const modelId = settings.minilm.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new TransformersEmbeddingHandler({ modelId })
            };
        }

        case 'transformers': {
            const modelId = settings.transformers.embedding.modelId;
            return {
                modelId: buildModelId(provider, modelId),
                handler: new TransformersEmbeddingHandler({ modelId })
            };
        }

        case 'custom': {
            const { apiKey, baseUrl, modelId } = settings.custom.embedding;
            // Custom embedding uses OpenAI-compatible format
            return {
                modelId: `custom::${baseUrl}::${modelId}`,
                handler: new OpenAIEmbeddingHandler({
                    apiKey,
                    baseUrl,
                    modelId
                })
            };
        }

        case 'plugin': {
            return selectPluginHandler(settings.plugin.embedding.modelId);
        }
    }
}

function selectPluginHandler(modelId: string): SelectedEmbeddingHandler | null {
    for (const instance of pluginManager.getInstances()) {
        const definition = instance.embeddingProviders.get(modelId);
        if (definition) {
            return {
                modelId: definition.model.id,
                handler: new PluginEmbeddingHandler(instance, definition.fnId)
            };
        }
    }
    return null;
}

function buildModelId(provider: EmbeddingProvider, modelId: string): string {
    return `${provider}::${modelId}`;
}
