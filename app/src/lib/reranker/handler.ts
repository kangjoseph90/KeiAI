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

        case 'transformers': {
            return new TransformersRerankerHandler({
                modelId: settings.transformers.reranker.modelId
            });
        }
    }
}
