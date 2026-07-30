/**
 * TTS Handler Selection — KeiAI
 *
 * Resolves a provider + settings into a concrete TTSHandler.
 * Model and voice IDs are stored directly in provider config (no registry lookup).
 */

import type { TTSHandler } from './types';
import type { AppSettings } from '$lib/services';
import type { TTSProvider } from '$lib/types/models/tts';
import { OpenAITTSHandler } from './handlers/openai';
import { TransformersTTSHandler } from './handlers/transformers';
import { KokoroTTSHandler } from './handlers/kokoro';
import { GoogleTTSHandler } from './handlers/google';
import { ElevenLabsTTSHandler } from './handlers/elevenlabs';
import { NovelAITTSHandler } from './handlers/novelai';
import { MockTTSHandler, type MockTTSBehavior } from './handlers/mock';
import { pluginManager } from '$lib/plugins';
import { PluginTTSHandler } from './handlers/plugin';

export function selectTTSHandler(provider: TTSProvider, settings: AppSettings): TTSHandler | null {
    switch (provider) {
        case 'openai': {
            return new OpenAITTSHandler({
                apiKey: settings.openai?.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                modelId: settings.openai.tts.modelId,
                voiceId: settings.openai.tts.voiceId
            });
        }

        case 'elevenlabs': {
            return new ElevenLabsTTSHandler({
                apiKey: settings.elevenlabs?.apiKey,
                baseUrl: 'https://api.elevenlabs.io/v1',
                modelId: settings.elevenlabs.tts.modelId,
                voiceId: settings.elevenlabs.tts.voiceId
            });
        }

        case 'google': {
            return new GoogleTTSHandler({
                apiKey: settings.google?.apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                modelId: settings.google.tts.modelId,
                voiceId: settings.google.tts.voiceId
            });
        }

        case 'novelai': {
            return new NovelAITTSHandler({
                apiKey: settings.novelai?.apiKey,
                baseUrl: 'https://api.novelai.net',
                voiceId: settings.novelai.tts.voiceId,
                version: settings.novelai.tts.version
            });
        }

        case 'kokoro': {
            return new KokoroTTSHandler({
                voiceId: settings.kokoro.tts.voiceId
            });
        }

        case 'transformers': {
            return new TransformersTTSHandler({
                modelId: settings.transformers.tts.modelId
            });
        }

        case 'mock': {
            return new MockTTSHandler({
                behavior: settings.mock.tts.modelId as MockTTSBehavior
            });
        }
        case 'plugin': {
            return selectPluginHandler(settings.plugin.tts.modelId);
        }
    }
}

function selectPluginHandler(modelId: string): TTSHandler | null {
    for (const instance of pluginManager.getInstances()) {
        const definition = instance.ttsProviders.get(modelId);
        if (definition) {
            return new PluginTTSHandler(instance, definition.fnId);
        }
    }
    return null;
}
