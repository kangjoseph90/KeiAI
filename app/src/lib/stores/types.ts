/**
 * Store-level Type Definitions
 *
 * Types used exclusively by the store/UI layer.
 * Domain types (Message, Chat, etc.) live in their respective services.
 * These types extend domain types with UI-specific concerns.
 */

import type { Message } from '$lib/services';

// ─── Generation Types ───────────────────────────────────────────────

export type GenerationStatus = 'generating' | 'error';

export interface GenerationTask {
	status: GenerationStatus;
	content: string;
	errorMessage?: string;
	abortController: AbortController;
}

// ─── Display Message Types ──────────────────────────────────────────

export type DisplayMessageStatus = 'completed' | 'generating' | 'error';

export interface DisplayMessage extends Message {
	displayStatus: DisplayMessageStatus;
	errorMessage?: string;
}
