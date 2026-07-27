/**
 * ImageGen Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete ImageGenHandler.
 * Model ID is stored directly in provider config (no registry lookup for built-ins).
 */

import type { ImageGenHandler as ImageGenHandlerType } from './types';
import type { AppSettings } from '$lib/services';
import type { ImageGenProvider } from '$lib/types/models/imagegen';
import { OpenAIImageGenHandler } from './handlers/openai';
import { StabilityImageGenHandler } from './handlers/stability';
import { GoogleImageGenHandler } from './handlers/google';
import { NovelAIImageGenHandler } from './handlers/novelai';
import { ComfyUIImageGenHandler } from './handlers/comfyui';
import { MockImageGenHandler, type MockImageGenBehavior } from './handlers/mock';

export function selectImageGenHandler(
    provider: ImageGenProvider,
    settings: AppSettings
): ImageGenHandlerType | null {
    switch (provider) {
        case 'openai': {
            return new OpenAIImageGenHandler({
                apiKey: settings.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                modelId: settings.openai.imagegen.modelId
            });
        }

        case 'stability': {
            return new StabilityImageGenHandler({
                apiKey: settings.stability.apiKey,
                baseUrl: 'https://api.stability.ai',
                modelId: settings.stability.imagegen.modelId
            });
        }

        case 'google': {
            return new GoogleImageGenHandler({
                apiKey: settings.google.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1',
                modelId: settings.google.imagegen.modelId
            });
        }

        case 'novelai': {
            return new NovelAIImageGenHandler({
                apiKey: settings.novelai.apiKey,
                baseUrl: 'https://image.novelai.net',
                ...settings.novelai.imagegen
            });
        }

        case 'comfyui': {
            return new ComfyUIImageGenHandler(settings.comfyui.imagegen);
        }

        case 'mock': {
            return new MockImageGenHandler({
                behavior: settings.mock.imagegen.modelId as MockImageGenBehavior
            });
        }
    }
}
