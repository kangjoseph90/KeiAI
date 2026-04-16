/**
 * Store-level Type Definitions
 *
 * Types used exclusively by the store/UI layer.
 * Domain types (Message, Chat, etc.) live in their respective services.
 * These types extend domain types with UI-specific concerns.
 */

import type { Message } from '$lib/services';

// ─── Chat Task ────────────────────────────────────────────────────────────────
export type TaskStatus = 'generating' | 'error';

import { type ToolCallAbstract, type ToolCallRequest } from '$lib/services/content/tool';

/**
 * Ephemeral in-flight chat task. Keyed by chatId.
 * Never persisted to DB as a "Task", but finalized into a "Message".
 * id is generated after the task is completed.
 */
export interface ChatTask {
	status: TaskStatus;
	errorMessage?: string;
	content: string;
	thought?: string;
	toolCalls?: ToolCallRequest[];
	/** If set, this task is a reroll of an existing message (not a new message). */
	targetMessageId?: string;
}

// ─── Display Message Types ────────────────────────────────────────────────────

export type DisplayMessageStatus = 'completed' | 'generating' | 'error';

export interface DisplayMessage extends Message {
	displayStatus: DisplayMessageStatus;
	errorMessage?: string;
}
