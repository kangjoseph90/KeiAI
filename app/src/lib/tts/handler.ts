/**
 * TTS Handler Selection — KeiAI
 *
 * Resolves a TTSModel + AppSettings into a concrete TTSStreamHandler.
 * Dispatches by provider for built-in models, by handler for custom models.
 */

import type { TTSStreamHandler } from './types';
import type { AppSettings } from '$lib/services';
import { OpenAITTSStreamHandler } from './handlers/openai';
import { createLogger } from '$lib/adapters/logger';
import {
	type TTSModel,
	type BuiltInTTSModel,
	type CustomTTSModel,
	BUILT_IN_TTS_MODELS
} from '$lib/types/models/tts';

const logger = createLogger('tts:handler');

export interface TTSHandlerOptions {
	modelId: string;
	voiceId: string;
}

export function selectTTSHandler(
	options: TTSHandlerOptions,
	settings: AppSettings
): TTSStreamHandler | null {
	const model = resolveModel(options.modelId, settings);

	if (!model) {
		logger.warn('TTS model not found.');
		return null;
	}

	// Custom models: dispatch by handler field
	if (model.provider === 'custom') {
		return selectCustomHandler(model, options);
	}

	// Built-in models: dispatch by provider
	return selectBuiltInHandler(model, options, settings);
}

function selectBuiltInHandler(
	model: BuiltInTTSModel,
	options: TTSHandlerOptions,
	settings: AppSettings
): TTSStreamHandler | null {
	switch (model.provider) {
		case 'openai': {
			const apiKey = settings.providers.openai?.apiKey;
			if (!apiKey) {
				logger.warn('No OpenAI API key for TTS.');
				return null;
			}
			return new OpenAITTSStreamHandler({
				apiKey,
				baseUrl: 'https://api.openai.com/v1',
				modelId: model.modelId,
				voiceId: options.voiceId
			});
		}

		case 'elevenlabs': {
			// TODO: implement ElevenLabsTTSStreamHandler
			logger.warn('ElevenLabs TTS not yet implemented.');
			return null;
		}

		case 'google': {
			// TODO: implement GoogleTTSStreamHandler
			logger.warn('Google TTS not yet implemented.');
			return null;
		}

		case 'kokoro':
			// TODO: implement KokoroTTSHandler — local, no API key needed
			logger.warn('Kokoro TTS not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown TTS provider: ${model.provider}`);
			return null;
	}
}

function selectCustomHandler(
	model: CustomTTSModel,
	options: TTSHandlerOptions
): TTSStreamHandler | null {
	if (!model.apiKey) {
		logger.warn('No API key for custom TTS model.');
		return null;
	}

	switch (model.handler) {
		case 'openai':
			return new OpenAITTSStreamHandler({
				apiKey: model.apiKey,
				baseUrl: model.baseUrl,
				modelId: model.modelId,
				voiceId: options.voiceId
			});

		case 'elevenlabs':
			logger.warn('Custom ElevenLabs handler not yet implemented.');
			return null;

		case 'google':
			logger.warn('Custom Google TTS handler not yet implemented.');
			return null;

		case 'onnx':
			logger.warn('Custom ONNX TTS handler not yet implemented.');
			return null;

		default:
			logger.warn(`Unknown custom TTS handler: ${model.handler}`);
			return null;
	}
}

function resolveModel(modelId: string, settings: AppSettings): TTSModel | undefined {
	// TODO: check settings.customTTSModels for custom models
	return BUILT_IN_TTS_MODELS.find((m) => m.id === modelId);
}
