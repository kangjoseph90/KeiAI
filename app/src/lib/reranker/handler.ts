/**
 * Reranker Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete RerankerHandler.
 * Model ID is stored directly in provider config (no registry lookup for built-ins).
 */

import type { RerankerHandler as RerankerHandlerType } from './types';
import type { AppSettings } from '$lib/services';
import type { RerankerProvider } from '$lib/types/models/reranker';
import { CohereRerankerHandler } from './handlers/cohere';
import { JinaRerankerHandler } from './handlers/jina';
import { VoyageAIRerankerHandler } from './handlers/voyageai';
import { TransformersRerankerHandler } from './handlers/transformers';
import { PluginRerankerHandler } from './handlers/plugin';
import { pluginManager } from '$lib/plugins';

export function selectRerankerHandler(
    provider: RerankerProvider,
    settings: AppSettings
): RerankerHandlerType | null {
    switch (provider) {
        case 'cohere': {
            return new CohereRerankerHandler({
                apiKey: settings.cohere.apiKey,
                baseUrl: 'https://api.cohere.ai',
                modelId: settings.cohere.reranker.modelId
            });
        }

        case 'jina': {
            return new JinaRerankerHandler({
                apiKey: settings.jina.apiKey,
                baseUrl: 'https://api.jina.ai',
                modelId: settings.jina.reranker.modelId
            });
        }

        case 'voyageai': {
            return new VoyageAIRerankerHandler({
                apiKey: settings.voyageai.apiKey,
                baseUrl: 'https://api.voyageai.com',
                modelId: settings.voyageai.reranker.modelId
            });
        }

        case 'openrouter': {
            return new CohereRerankerHandler({
                apiKey: settings.openrouter.apiKey,
                baseUrl: 'https://openrouter.ai/api',
                modelId: settings.openrouter.reranker.modelId
            });
        }

        case 'transformers': {
            return new TransformersRerankerHandler({
                modelId: settings.transformers.reranker.modelId
            });
        }

        case 'plugin': {
            return selectPluginHandler(settings.plugin.reranker.modelId);
        }
    }
}

function selectPluginHandler(modelId: string): RerankerHandlerType | null {
    for (const instance of pluginManager.getInstances()) {
        const definition = instance.rerankerProviders.get(modelId);
        if (definition) {
            return new PluginRerankerHandler(instance, definition.fnId);
        }
    }
    return null;
}
