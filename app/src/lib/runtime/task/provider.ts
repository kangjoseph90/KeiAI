/**
 * Provider Selection — KeiAI
 *
 * Selects the appropriate StreamProvider based on preset configuration.
 * This allows different models for different use cases (chat, translation, etc.).
 */

import type { StreamProvider } from '$lib/llm/types';
import { MockStreamProvider } from '$lib/llm/mock';
import { OpenAIStreamProvider } from '$lib/llm/providers/openai';
import type { ChatContext } from '../context/chat';

const OPENAI_BASE_URL = 'https://api.githubcopilot.com';

/**
 * Select the appropriate provider based on preset + app settings.
 * Falls back to MockStreamProvider when no API key is configured.
 */
export async function selectProvider(ctx: ChatContext): Promise<StreamProvider> {
	const settings = await ctx.getSettings();
	const preset = await ctx.getPreset();

	const model = preset?.data.model ?? '';

	// Determine which API key to use based on model name
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
	// Anthropic models through OpenAI-compatible proxy (e.g. OpenRouter)
	// or direct OpenAI API
	return OPENAI_BASE_URL;
}
