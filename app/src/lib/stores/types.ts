/**
 * Store-level Type Definitions
 *
 * Types used exclusively by the store/UI layer.
 * Domain types (Message, Chat, etc.) live in their respective services.
 * These types extend domain types with UI-specific concerns.
 */

import type { Message } from '$lib/services';

// ─── Task Meta (per-kind payload) ─────────────────────────────────────────────

/** Metadata for a chat response generation task. */
export interface ChatTaskMeta {
	kind: 'chat';
	chatId: string;
}

// Future: TranslationTaskMeta, TitleTaskMeta, ...

/** Discriminated union of all task kinds. */
export type TaskMeta = ChatTaskMeta;

export type TaskKind = TaskMeta['kind'];

// ─── Runtime Task ─────────────────────────────────────────────────────────────

export type TaskStatus = 'generating' | 'error';

/**
 * Ephemeral in-flight task. Never persisted to DB.
 *
 * `meta` tells the task store what kind of work is happening and where
 * to write the result when finalized. AbortController lives in the
 * pipeline layer (runtime/task/*) — it controls execution, not display state.
 */
export interface RuntimeTask {
	id: string;
	status: TaskStatus;
	content: string;
	errorMessage?: string;
	meta: TaskMeta;
}

// ─── Display Message Types ────────────────────────────────────────────────────

export type DisplayMessageStatus = 'completed' | 'generating' | 'error';

export interface DisplayMessage extends Message {
	displayStatus: DisplayMessageStatus;
	errorMessage?: string;
}
