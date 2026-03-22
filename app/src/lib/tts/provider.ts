/**
 * TTS Provider Selection — KeiAI
 *
 * Resolves a TTSProvider name + AppSettings into a concrete TTSStreamProvider.
 * Each provider is its own class (no shared format abstraction).
 */

import type { TTSStreamProvider } from './types';
import type { TTSModelConfig, TTSProvider } from '$lib/types/models/tts';
import type { AppSettings } from '$lib/services';
import { OpenAITTSStreamProvider } from './providers/openai';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('tts:provider');

export function selectTTSProvider(
	modelConfig: TTSModelConfig,
	settings: AppSettings
): TTSStreamProvider | null {
	switch (modelConfig.provider) {
		case 'openai': {
			const apiKey = settings.apiKeys.openai;
			if (!apiKey) {
				logger.warn('No OpenAI API key for TTS.');
				return null;
			}
			return new OpenAITTSStreamProvider({ apiKey, voiceId: modelConfig.voiceId });
		}

		case 'elevenlabs': {
			// TODO: implement ElevenLabsTTSStreamProvider
			logger.warn('ElevenLabs TTS not yet implemented.');
			return null;
		}

		case 'google': {
			// TODO: implement GoogleTTSStreamProvider
			logger.warn('Google TTS not yet implemented.');
			return null;
		}

		case 'kokoro': {
			// TODO: implement KokoroTTSStreamProvider (local)
			logger.warn('Kokoro TTS not yet implemented.');
			return null;
		}

		default: {
			logger.warn(`Unknown TTS provider: ${modelConfig.provider}`);
			return null;
		}
	}
}
