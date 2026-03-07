/**
 * Generation Store — LLM Task Lifecycle Management
 *
 * Manages ephemeral in-flight generation tasks.
 * These are UI-only state — never persisted to DB.
 *
 * When a generation completes (or is stopped by the user),
 * the caller (GenerationManager / future layer) finalizes by:
 *   1. Calling stores/message.ts → createMessage()  (DB + confirmed store)
 *   2. Calling clearTask() here                      (removes the virtual bubble)
 *
 * The activeChatId guard is NOT needed here because generationTasks
 * is keyed by chatId, and the derived uiMessages in state.ts already
 * filters by activeChat. Tasks for non-active chats are invisible to the UI
 * but remain alive so streaming isn't interrupted when switching rooms.
 */

import { get } from 'svelte/store';
import { generationTasks } from './state';
import type { GenerationTask } from './types';

// ─── Task Lifecycle ─────────────────────────────────────────────────

/**
 * Begin a new generation task for a chat.
 * Creates an AbortController the UI can use to stop generation.
 */
export function startTask(chatId: string): AbortController {
	const controller = new AbortController();
	generationTasks.update((map) => {
		const next = new Map(map);
		next.set(chatId, {
			status: 'generating',
			content: '',
			abortController: controller
		});
		return next;
	});
	return controller;
}

/**
 * Append a streaming chunk to the task's accumulated content.
 * No-op if the task was already cleared.
 */
export function appendChunk(chatId: string, chunk: string): void {
	generationTasks.update((map) => {
		const task = map.get(chatId);
		if (!task) return map;
		const next = new Map(map);
		next.set(chatId, { ...task, content: task.content + chunk });
		return next;
	});
}

/**
 * Replace the task's content with a fully processed value.
 * Used by the pipeline after applying output scripts to accumulated raw content.
 * No-op if the task was already cleared.
 */
export function setTaskContent(chatId: string, content: string): void {
	generationTasks.update((map) => {
		const task = map.get(chatId);
		if (!task) return map;
		const next = new Map(map);
		next.set(chatId, { ...task, content });
		return next;
	});
}

/**
 * Mark the task as failed. The virtual bubble stays visible with error UI
 * so the user can retry or dismiss.
 */
export function setTaskError(chatId: string, errorMessage: string): void {
	generationTasks.update((map) => {
		const task = map.get(chatId);
		if (!task) return map;
		const next = new Map(map);
		next.set(chatId, { ...task, status: 'error', errorMessage });
		return next;
	});
}

/**
 * Remove the task entirely. Called after:
 *   - Successful finalization (content saved to DB → confirmed message added)
 *   - User dismisses an error
 */
export function clearTask(chatId: string): void {
	generationTasks.update((map) => {
		if (!map.has(chatId)) return map;
		const next = new Map(map);
		next.delete(chatId);
		return next;
	});
}

/**
 * Abort the in-flight request. The GenerationManager should catch the
 * AbortError and decide whether to save partial content or discard it.
 */
export function stopGeneration(chatId: string): void {
	const task = get(generationTasks).get(chatId);
	task?.abortController.abort();
}

/**
 * Get a snapshot of the current task for a given chat.
 * Returns undefined if no task is active.
 */
export function getTask(chatId: string): GenerationTask | undefined {
	return get(generationTasks).get(chatId);
}
