/**
 * Embedding Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete EmbeddingHandler.
 * Model ID is stored directly in provider config (no registry lookup for built-ins).
 */

import type { EmbeddingHandler as EmbeddingHandlerType } from './types';
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
): EmbeddingHandlerType | null {
    switch (provider) {
        case 'openai': {
            return new OpenAIEmbeddingHandler({
                apiKey: settings.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                modelId: settings.openai.embedding.modelId
            });
        }

        case 'google': {
            return new GoogleEmbeddingHandler({
                apiKey: settings.google.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                modelId: settings.google.embedding.modelId
            });
        }

        case 'voyageai': {
            return new OpenAIEmbeddingHandler({
                apiKey: settings.voyageai.apiKey,
                baseUrl: 'https://api.voyageai.com/v1',
                modelId: settings.voyageai.embedding.modelId
            });
        }

        case 'openrouter': {
            return new OpenAIEmbeddingHandler({
                apiKey: settings.openrouter.apiKey,
                baseUrl: 'https://openrouter.ai/api/v1',
                modelId: settings.openrouter.embedding.modelId
            });
        }

        case 'minilm':
        case 'transformers': {
            return new TransformersEmbeddingHandler({
                modelId: settings.transformers.embedding.modelId
            });
        }

        case 'custom': {
            // Custom embedding uses OpenAI-compatible format
            return new OpenAIEmbeddingHandler({
                apiKey: settings.custom.embedding.apiKey,
                baseUrl: settings.custom.embedding.baseUrl,
                modelId: settings.custom.embedding.modelId
            });
        }

        case 'plugin': {
            return selectPluginHandler(settings.plugin.embedding.modelId);
        }
    }
}

function selectPluginHandler(modelId: string): EmbeddingHandlerType | null {
    for (const instance of pluginManager.getInstances()) {
        const definition = instance.embeddingProviders.get(modelId);
        if (definition) {
            return new PluginEmbeddingHandler(instance, definition.fnId);
        }
    }
    return null;
}
