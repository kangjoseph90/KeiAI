/**
 * Runtime Store — Mapping-Aware Generic Task Store
 *
 * Manages ephemeral in-flight tasks and their optional mappings to domain entities.
 * These are UI-only — never persisted to DB.
 *
 * Responsibilities:
 *   - Create / update / clear task state in runtimeTasks store
 *   - Manage optional mappings (chatId → taskId) in chatTaskIds store
 *   - No knowledge of domain-specific finalize logic (createMessage, etc.)
 */

import { get } from 'svelte/store';
import { runtimeTasks, chatTaskIds } from '../state';
import type { RuntimeTask, TaskMeta } from '../types';
import { generateId } from '$lib/shared/id';

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Register a new task in the store.
 * Ifkind is 'chat', it also updates the chatTaskIds mapping.
 * Returns the generated taskId.
 */
export function createTask(meta: TaskMeta): string {
	const id = generateId();
	runtimeTasks.update((map) => {
		const next = new Map(map);
		next.set(id, { id, status: 'generating', content: '', meta });
		return next;
	});

	if (meta.kind === 'chat') {
		chatTaskIds.update((map) => {
			const next = new Map(map);
			next.set(meta.chatId, id);
			return next;
		});
	}

	return id;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

/**
 * Append a streaming chunk to the task's accumulated raw content.
 */
export function appendChunk(taskId: string, chunk: string): void {
	runtimeTasks.update((map) => {
		const task = map.get(taskId);
		if (!task) return map;
		const next = new Map(map);
		next.set(taskId, { ...task, content: task.content + chunk });
		return next;
	});
}

/**
 * Replace the task's content with a fully processed value.
 */
export function setTaskContent(taskId: string, content: string): void {
	runtimeTasks.update((map) => {
		const task = map.get(taskId);
		if (!task) return map;
		const next = new Map(map);
		next.set(taskId, { ...task, content });
		return next;
	});
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Mark the task as failed.
 */
export function setTaskError(taskId: string, errorMessage: string): void {
	runtimeTasks.update((map) => {
		const task = map.get(taskId);
		if (!task) return map;
		const next = new Map(map);
		next.set(taskId, { ...task, status: 'error', errorMessage });
		return next;
	});
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Remove the task and any associated mappings.
 */
export function clearTask(taskId: string): void {
	const task = get(runtimeTasks).get(taskId);
	if (!task) return;

	// Internal cleanup function to maintain atomicity in update blocks if needed,
	// but here we just update sequentially.
	runtimeTasks.update((map) => {
		const next = new Map(map);
		next.delete(taskId);
		return next;
	});

	if (task.meta.kind === 'chat') {
		chatTaskIds.update((map) => {
			const next = new Map(map);
			next.delete(task.meta.chatId);
			return next;
		});
	}
}

/**
 * Helper to clear a task by its chatId.
 */
export function clearChatTask(chatId: string): void {
	const taskId = get(chatTaskIds).get(chatId);
	if (taskId) {
		clearTask(taskId);
	}
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get a snapshot of the current task.
 */
export function getTask(taskId: string): RuntimeTask | null {
	return get(runtimeTasks).get(taskId) ?? null;
}

/**
 * Get the taskId currently associated with a chatId.
 */
export function getChatTaskId(chatId: string): string | null {
	return get(chatTaskIds).get(chatId) ?? null;
}
