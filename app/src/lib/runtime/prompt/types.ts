/**
 * Prompt Types — KeiAI
 *
 * Core types for prompt building and OpenAI-compatible message formats.
 */

// OpenAI-compatible chat message type
export interface OpenAIChat {
	role: 'system' | 'user' | 'assistant';
	content: string;
	thought?: string;
}
