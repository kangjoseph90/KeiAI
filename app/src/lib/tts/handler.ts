/**
 * TTS Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete TTSStreamHandler.
 * Model and voice IDs are stored directly in provider config (no registry lookup).
 */

import type { TTSStreamHandler } from './types';
import type { AppSettings } from '$lib/services';
import type { TTSProvider } from '$lib/types/models/tts';
import { OpenAITTSStreamHandler } from './handlers/openai';
import { TransformersTTSStreamHandler } from './handlers/transformers';
import { KokoroTTSStreamHandler } from './handlers/kokoro';
import { GoogleTTSStreamHandler } from './handlers/google';
import { ElevenLabsTTSStreamHandler } from './handlers/elevenlabs';
import { NovelAITTSStreamHandler } from './handlers/novelai';
import { MockTTSStreamHandler, type MockTTSBehavior } from './handlers/mock';
import { pluginManager } from '$lib/plugins';
import { PluginTTSStreamHandler } from './handlers/plugin';

export function selectTTSHandler(
    provider: TTSProvider,
    settings: AppSettings
): TTSStreamHandler | null {
    switch (provider) {
        case 'openai': {
            return new OpenAITTSStreamHandler({
                apiKey: settings.openai?.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                modelId: settings.openai.tts.modelId,
                voiceId: settings.openai.tts.voiceId
            });
        }

        case 'elevenlabs': {
            return new ElevenLabsTTSStreamHandler({
                apiKey: settings.elevenlabs?.apiKey,
                baseUrl: 'https://api.elevenlabs.io/v1',
                modelId: settings.elevenlabs.tts.modelId,
                voiceId: settings.elevenlabs.tts.voiceId
            });
        }

        case 'google': {
            return new GoogleTTSStreamHandler({
                apiKey: settings.google?.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                modelId: settings.google.tts.modelId,
                voiceId: settings.google.tts.voiceId
            });
        }

        case 'novelai': {
            return new NovelAITTSStreamHandler({
                apiKey: settings.novelai?.apiKey,
                baseUrl: 'https://api.novelai.net',
                voiceId: settings.novelai.tts.voiceId,
                version: settings.novelai.tts.version
            });
        }

        case 'kokoro': {
            return new KokoroTTSStreamHandler({
                voiceId: settings.kokoro.tts.voiceId
            });
        }

        case 'transformers': {
            return new TransformersTTSStreamHandler({
                modelId: settings.transformers.tts.modelId
            });
        }

        case 'mock': {
            return new MockTTSStreamHandler({
                behavior: settings.mock.tts.modelId as MockTTSBehavior
            });
        }
        case 'plugin': {
            return selectPluginHandler(settings.plugin.tts.modelId);
        }
    }
}

function selectPluginHandler(modelId: string): TTSStreamHandler | null {
    for (const instance of pluginManager.getInstances()) {
        const definition = instance.ttsProviders.get(modelId);
        if (definition) {
            return new PluginTTSStreamHandler(instance, definition.fnId);
        }
    }
    return null;
}
