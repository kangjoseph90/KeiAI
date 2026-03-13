/**
 * Chat Task Store — Domain-Specific Generation State
 *
 * Manages ephemeral in-flight chat tasks. Keyed by chatId.
 * These are UI-only — never persisted to DB.
 */

import { get } from 'svelte/store';
import { chatTasks } from '../state';
import type { ChatTask } from '../types';
import type { StreamContent } from '$lib/llm/types';

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Register a new chat task in the store.
 */
export function createChatTask(chatId: string): void {
	chatTasks.update((map) => {
		const next = new Map(map);
		next.set(chatId, {
			chatId,
			status: 'generating',
			content: '',
			thought: '',
			toolCalls: []
		});
		return next;
	});
}

// ─── Streaming ────────────────────────────────────────────────────────────────

/**
 * Update the chat task state with the latest stream content.
 */
export function updateChatTask(chatId: string, state: StreamContent): void {
	chatTasks.update((map) => {
		const task = map.get(chatId);
		if (!task) return map;
		const next = new Map(map);
		next.set(chatId, {
			...task,
			content: state.content,
			thought: state.thought,
			toolCalls: state.toolCalls
		});
		return next;
	});
}

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

/**
 * Consume the task: return a snapshot and immediately clear it from
 * the store. The runtime layer is responsible for persisting to DB.
 */
export function consumeChatTask(chatId: string): ChatTask | null {
	const task = getChatTask(chatId);
	if (!task) return null;
	clearChatTask(chatId);
	return task;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get a snapshot of the current chat task.
 */
export function getChatTask(chatId: string): ChatTask | null {
	return get(chatTasks).get(chatId) ?? null;
}
