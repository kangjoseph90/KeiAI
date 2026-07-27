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

/**
 * Thin generation state tracker. Keyed by chatId.
 * The message/swipe already exists in DB — this just tracks which one is being generated.
 */
export interface ChatTask {
    status: TaskStatus;
    errorMessage?: string;
    /** The message being generated (already persisted to DB). */
    messageId: string;
    /** AbortController for cancelling the in-flight generation. */
    controller: AbortController;
}

export interface TranslationTask {
    status: TaskStatus;
    errorMessage?: string;
    sourceHash: string;
    controller: AbortController;
}

export interface MediaTask {
    status: TaskStatus;
    errorMessage?: string;
    controller: AbortController;
}

// ─── Display Message Types ────────────────────────────────────────────────────

export type DisplayMessageStatus = 'completed' | 'generating' | 'error';

export interface DisplayMessage extends Message {
    displayStatus: DisplayMessageStatus;
    messageIndex?: number;
    errorMessage?: string;
}
