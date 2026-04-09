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
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				modelId: settings.google.imagegen.modelId
			});
		}
	}
}
