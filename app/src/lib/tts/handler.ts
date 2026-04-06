/**
 * TTS Handler Selection — KeiAI
 *
 * Resolves a TTSModelConfig + AppSettings into a concrete TTSStreamHandler.
 * Mirrors LLM/Embedding pattern: resolveModel → resolveConnection → class by handler.
 */

import type { TTSStreamHandler } from './types';
import type { AppSettings } from '$lib/services';
import { OpenAITTSStreamHandler } from './handlers/openai';
import { createLogger } from '$lib/adapters/logger';
import {
	type TTSModelConfig,
	type TTSModel,
	type RemoteTTSProvider,
	BUILT_IN_TTS_MODELS,
	getTTSProviderUrl,
	isRemoteTTSProvider
} from '$lib/types/models/tts';

const logger = createLogger('tts:handler');

export function selectTTSHandler(
	modelConfig: TTSModelConfig,
	settings: AppSettings
): TTSStreamHandler | null {
	const model = resolveModel(modelConfig, settings);

	if (!model) {
		logger.warn('TTS model not found.');
		return null;
	}

	const connection = resolveConnection(model, settings);

	if (!connection.apiKey) {
		logger.warn('No API key found for TTS.');
		return null;
	}

	switch (model.handler) {
		case 'openai':
			return new OpenAITTSStreamHandler({
				apiKey: connection.apiKey,
				baseUrl: connection.baseUrl,
				modelId: model.modelId,
				voiceId: modelConfig.voiceId
			});

		case 'elevenlabs':
			// TODO: implement ElevenLabsTTSStreamHandler
			logger.warn('ElevenLabs TTS not yet implemented.');
			return null;

		case 'google':
			// TODO: implement GoogleTTSStreamHandler
			logger.warn('Google TTS not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown TTS handler: ${model.handler}`);
			return null;
	}
}

function resolveModel(config: TTSModelConfig, settings: AppSettings): TTSModel | undefined {
	if (config.provider === 'custom') {
		// TODO: settings.customTTSModels
		return undefined;
	}
	return BUILT_IN_TTS_MODELS.find((m) => m.id === config.id);
}

function resolveConnection(
	model: TTSModel,
	settings: AppSettings
): { baseUrl: string; apiKey: string | undefined } {
	if (model.provider === 'custom') {
		return { baseUrl: model.baseUrl, apiKey: model.apiKey };
	}

	if (isRemoteTTSProvider(model.provider)) {
		return {
			baseUrl: getTTSProviderUrl(model.provider),
			apiKey: settings.apiKeys[model.provider]
		};
	}

	// Local provider (e.g. kokoro)
	return {
		baseUrl: '',
		apiKey: 'local'
	};
}
