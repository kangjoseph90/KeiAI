/**
 * Provider Selection — KeiAI
 *
 * Pure function: preset + settings in, StreamProvider out.
 */

import type { StreamProvider } from '$lib/llm/types';
import { MockStreamProvider } from '$lib/llm/providers';
import { OpenAIStreamProvider } from '$lib/llm/providers/openai';
import type { PresetDetail, AppSettings } from '$lib/services';

const OPENAI_BASE_URL = 'https://api.githubcopilot.com';

/**
 * Select the appropriate provider based on preset + app settings.
 * Falls back to MockStreamProvider when no API key is configured.
 */
export function selectProvider(preset: PresetDetail | null, settings: AppSettings): StreamProvider {
	const model = preset?.data.model ?? '';

	const apiKey = resolveApiKey(model, settings.apiKeys);

	if (!apiKey) {
		console.warn('[selectProvider] No API key found. Falling back to MockStreamProvider.');
		return new MockStreamProvider();
	}

	const baseUrl = resolveBaseUrl(model);

	return new OpenAIStreamProvider({
		apiKey,
		baseUrl,
		model,
		params: preset
			? {
					temperature: preset.data.temperature,
					top_p: preset.data.topP,
					frequency_penalty: preset.data.frequencyPenalty,
					presence_penalty: preset.data.presencePenalty,
					max_tokens: preset.data.maxResponse
				}
			: undefined
	});
}

/**
 * Resolve API key from model name.
 * Convention: model string prefix determines the provider.
 */
function resolveApiKey(
	model: string,
	apiKeys: { openai?: string; anthropic?: string }
): string | undefined {
	if (model.startsWith('claude')) return apiKeys.anthropic;
	return apiKeys.openai;
}

/**
 * Resolve base URL from model name.
 * For now, defaults to OpenAI. Extendable for custom endpoints later.
 */
function resolveBaseUrl(model: string): string {
	return OPENAI_BASE_URL;
}
