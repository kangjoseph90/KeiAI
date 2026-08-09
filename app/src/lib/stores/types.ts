/**
 * Store-level Type Definitions
 *
 * Types used exclusively by the store/UI layer.
 * Domain types (Message, Chat, etc.) live in their respective services.
 * These types extend domain types with UI-specific concerns.
 */

import type { Message } from '$lib/services';

// ─── Chat Task ────────────────────────────────────────────────────────────────
export type TaskStatus = 'generating' | 'completed' | 'error';

export interface TaskMetadata {
    roomId: string;
    chatId: string;
    chatTitle: string;
    title: string;
    startedAt: number;
    finishedAt?: number;
}

export type CreateTaskMetadata = Omit<TaskMetadata, 'startedAt' | 'finishedAt'>;

/**
 * Thin generation state tracker. Keyed by chatId.
 * The message/swipe already exists in DB — this just tracks which one is being generated.
 */
export interface ChatTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    /** The message being generated (already persisted to DB). */
    messageId: string;
    /** AbortController for cancelling the in-flight generation. */
    controller?: AbortController;
}

export interface TranslationTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    sourceHash: string;
    controller?: AbortController;
}

export interface MediaTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    controller?: AbortController;
}

export interface InputTranslationTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    controller?: AbortController;
}

export interface SuggestionTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    controller?: AbortController;
}

export interface TitleTask extends TaskMetadata {
    status: TaskStatus;
    errorMessage?: string;
    controller?: AbortController;
}

export interface ChatDraft {
    text: string;
    inlayIds: string[];
    suggestions: Record<string, string>;
}

export type DictationPhase = 'recording' | 'transcribing' | 'error';

export interface DictationTask extends TaskMetadata {
    id: string;
    phase: DictationPhase;
    status: TaskStatus;
    levels: number[];
    errorMessage?: string;
}

export type CollectedTaskKind =
    | 'chat'
    | 'dictation'
    | 'translation'
    | 'tts'
    | 'image'
    | 'input_translation'
    | 'suggestion'
    | 'title';
export type CollectedTaskStatus = 'running' | 'completed' | 'error';

export interface CollectedTask {
    id: string;
    kind: CollectedTaskKind;
    taskKey: string;
    roomId: string;
    chatId: string;
    chatTitle: string;
    title: string;
    status: CollectedTaskStatus;
    phase?: string;
    errorMessage?: string;
    startedAt: number;
    finishedAt?: number;
}

export type ChatTaskIndicator = 'running' | 'completed' | 'error';

// ─── Display Message Types ────────────────────────────────────────────────────

export type DisplayMessageStatus = 'completed' | 'generating' | 'error';

export interface DisplayMessage extends Message {
    displayStatus: DisplayMessageStatus;
    messageIndex?: number;
    errorMessage?: string;
}
