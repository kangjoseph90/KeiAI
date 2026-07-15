/**
 * Chat Task Store — Thin Generation State Tracker
 *
 * Tracks which message/swipe is currently being generated.
 * The message already exists in DB — this is UI state only.
 * Keyed by chatId.
 */

import { get } from 'svelte/store';
import { activeChatId, chatTasks } from '../state';
import type { ChatTask } from '../types';
import { isDocumentVisible, showTaskNotificationOrToast } from './notification';

const CHAT_COMPLETE_TITLE = 'Response ready';
const CHAT_COMPLETE_DESCRIPTION = 'A chat response has finished generating.';
const CHAT_ERROR_TITLE = 'Chat task failed';

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Register a new generation task.
 * The message/swipe must already exist in DB before calling this.
 */
export function createChatTask(
    chatId: string,
    messageId: string,
    controller: AbortController
): void {
    chatTasks.update((map) => {
        const next = new Map(map);
        next.set(chatId, {
            status: 'generating',
            messageId,
            controller
        });
        return next;
    });
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Mark the task as failed.
 */
export function setChatTaskError(chatId: string, errorMessage: string): void {
    chatTasks.update((map) => {
        const task = map.get(chatId);
        if (!task) return map;
        const next = new Map(map);
        next.set(chatId, { ...task, status: 'error', errorMessage });
        return next;
    });
}

export function notifyChatTaskComplete(chatId: string): void {
    if (get(activeChatId) === chatId && isDocumentVisible()) return;

    void showTaskNotificationOrToast('success', CHAT_COMPLETE_TITLE, CHAT_COMPLETE_DESCRIPTION);
}

export function notifyChatTaskError(_chatId: string, errorMessage: string): void {
    void showTaskNotificationOrToast('error', CHAT_ERROR_TITLE, errorMessage);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Remove the task for a specific chatId.
 */
export function clearChatTask(chatId: string): void {
    chatTasks.update((map) => {
        if (!map.has(chatId)) return map;
        const next = new Map(map);
        next.delete(chatId);
        return next;
    });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns chat task snapshot from in-memory store.
 * Returns null if no task exists for the given chatId
 */
export function getChatTask(chatId: string): ChatTask | null {
    return get(chatTasks).get(chatId) ?? null;
}
