/**
 * STT Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete STTHandler.
 * Model ID is stored directly in provider config (no registry lookup for built-ins).
 */

import type { STTHandler as STTHandlerType } from './types';
import type { AppSettings } from '$lib/services';
import type { STTProvider } from '$lib/types/models/stt';
import { OpenAISTTHandler } from './handlers/openai';
import { GoogleSTTHandler } from './handlers/google';
import { TransformersSTTHandler } from './handlers/transformers';
import { MockSTTHandler, type MockSTTBehavior } from './handlers/mock';

export function selectSTTHandler(
    provider: STTProvider,
    settings: AppSettings
): STTHandlerType | null {
    switch (provider) {
        case 'openai': {
            return new OpenAISTTHandler({
                apiKey: settings.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                modelId: settings.openai.stt.modelId
            });
        }

        case 'groq': {
            return new OpenAISTTHandler({
                apiKey: settings.groq.apiKey,
                baseUrl: 'https://api.groq.com/openai/v1',
                modelId: settings.groq.stt.modelId
            });
        }

        case 'google': {
            return new GoogleSTTHandler({
                apiKey: settings.google.apiKey,
                baseUrl: 'https://speech.googleapis.com',
                modelId: settings.google.stt.modelId
            });
        }

        case 'transformers': {
            return new TransformersSTTHandler({
                modelId: settings.transformers.stt.modelId
            });
        }

        case 'mock': {
            return new MockSTTHandler({
                behavior: settings.mock.stt.modelId as MockSTTBehavior
            });
        }
    }
}
