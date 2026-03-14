/**
 * Provider Selection — KeiAI
 *
 * Selects the appropriate StreamProvider based on preset configuration.
 * This allows different models for different use cases (chat, translation, etc.).
 */

import type { StreamProvider } from '$lib/llm/types';
import type { OpenAIChat } from '$lib/runtime/prompt/types';
import { MockStreamProvider } from '$lib/llm/mock';

/**
 * Select the appropriate provider based on preset settings.
 * TODO: Implement real provider selection (OpenAI, Claude, custom, etc.)
 */
export async function selectProvider(): Promise<StreamProvider> {
	// For now, always use MockStreamProvider
	// In the future, this will check preset.model and return the appropriate provider
	return new MockStreamProvider();
}
